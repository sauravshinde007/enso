// server/controllers/teamController.js
import mongoose from "mongoose";
import Team, { BOT_PROVIDERS } from "../models/Team.js";
import BotTask from "../models/BotTask.js";
import User from "../models/User.js";
import { parseRepoUrl, getRepoNotices, isLowPriority, gh, GitHubError } from "../services/githubService.js";
import { LLM_PROVIDERS } from "../services/llmService.js";
import { enqueueBotTask, notifyTeam } from "../services/issueBotService.js";
import { encryptSecret, decryptSecret, secretHint } from "../utils/secrets.js";

const USER_FIELDS = "username avatar role";

const isAdmin = (req) => req.userData.role === "admin";
const isLeader = (team, req) => String(team.leader?._id || team.leader) === String(req.userData.userId);
const canManage = (team, req) => isAdmin(req) || isLeader(team, req);
const canView = (team, req) =>
  canManage(team, req) || team.members.some((m) => String(m._id || m) === String(req.userData.userId));

const toDto = (team, req) => ({
  _id: team._id,
  name: team.name,
  description: team.description,
  leader: team.leader,
  members: team.members,
  repo: team.repo?.owner ? team.repo : null,
  hasGithubToken: !!team.githubTokenHint,
  githubTokenHint: team.githubTokenHint,
  bot: {
    provider: team.bot?.provider,
    model: team.bot?.model || "",
    hasApiKey: !!team.bot?.apiKeyHint,
    apiKeyHint: team.bot?.apiKeyHint,
  },
  lowPriorityLabels: team.lowPriorityLabels,
  isLeader: isLeader(team, req),
  canManage: canManage(team, req),
  createdAt: team.createdAt,
});

const toObjectIds = (ids) =>
  [...new Set((Array.isArray(ids) ? ids : []).map(String))]
    .filter((id) => mongoose.Types.ObjectId.isValid(id));

const myTeamsQuery = (req) => {
  if (isAdmin(req)) return {};
  const me = req.userData.userId;
  return { $or: [{ leader: me }, { members: me }] };
};

// GET /api/teams  — teams I lead / belong to (admins: all)
export const getMyTeams = async (req, res) => {
  try {
    const teams = await Team.find(myTeamsQuery(req))
      .populate("leader", USER_FIELDS)
      .populate("members", USER_FIELDS)
      .sort({ name: 1 });
    res.json({
      teams: teams.map((t) => toDto(t, req)),
      providers: Object.entries(LLM_PROVIDERS).map(([id, p]) => ({ id, label: p.label, defaultModel: p.defaultModel })),
    });
  } catch (err) {
    console.error("getMyTeams error:", err);
    res.status(500).json({ message: "Failed to load teams" });
  }
};

// GET /api/teams/directory — user list for the member picker (admins and team leaders)
export const getDirectory = async (req, res) => {
  try {
    if (!isAdmin(req)) {
      const leads = await Team.exists({ leader: req.userData.userId });
      if (!leads) return res.status(403).json({ message: "Only admins and team leaders can list users" });
    }
    const users = await User.find({}, USER_FIELDS).sort({ username: 1 });
    res.json(users);
  } catch (err) {
    console.error("getDirectory error:", err);
    res.status(500).json({ message: "Failed to load users" });
  }
};

// POST /api/teams  (admin)
export const createTeam = async (req, res) => {
  try {
    const { name, description, leaderId, memberIds } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: "Team name is required" });
    if (!mongoose.Types.ObjectId.isValid(leaderId) || !(await User.exists({ _id: leaderId }))) {
      return res.status(400).json({ message: "A valid team leader is required" });
    }

    const members = toObjectIds(memberIds).filter((id) => id !== String(leaderId));
    const team = await Team.create({
      name: name.trim(),
      description: description?.trim() || "",
      leader: leaderId,
      members,
      createdBy: req.userData.userId,
    });
    await team.populate([{ path: "leader", select: USER_FIELDS }, { path: "members", select: USER_FIELDS }]);
    await notifyTeam(team._id);
    res.status(201).json(toDto(team, req));
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ message: "A team with this name already exists" });
    console.error("createTeam error:", err);
    res.status(500).json({ message: "Failed to create team" });
  }
};

// PUT /api/teams/:id  (admin or the team leader)
export const updateTeam = async (req, res) => {
  try {
    const team = await Team.findById(req.params.id);
    if (!team) return res.status(404).json({ message: "Team not found" });
    if (!canManage(team, req)) return res.status(403).json({ message: "Only the team leader or an admin can edit this team" });

    const { name, description, leaderId, memberIds, repoUrl, githubToken, bot, lowPriorityLabels } = req.body;

    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ message: "Team name cannot be empty" });
      team.name = name.trim();
    }
    if (description !== undefined) team.description = String(description).trim();

    if (leaderId !== undefined && String(leaderId) !== String(team.leader)) {
      if (!isAdmin(req)) return res.status(403).json({ message: "Only admins can change the team leader" });
      if (!mongoose.Types.ObjectId.isValid(leaderId) || !(await User.exists({ _id: leaderId }))) {
        return res.status(400).json({ message: "Invalid leader" });
      }
      team.leader = leaderId;
    }

    if (memberIds !== undefined) {
      team.members = toObjectIds(memberIds).filter((id) => id !== String(team.leader));
    }

    if (repoUrl !== undefined) {
      if (!repoUrl) {
        team.repo = { owner: null, name: null, url: null };
      } else {
        const repo = parseRepoUrl(repoUrl);
        if (!repo) return res.status(400).json({ message: "Not a valid GitHub repository URL" });
        team.repo = repo;
      }
    }

    if (githubToken !== undefined) {
      // "" clears the token; anything else replaces it
      team.githubTokenEnc = githubToken ? encryptSecret(githubToken.trim()) : null;
      team.githubTokenHint = githubToken ? secretHint(githubToken.trim()) : null;
    }

    if (bot) {
      if (bot.provider !== undefined) {
        if (!BOT_PROVIDERS.includes(bot.provider)) return res.status(400).json({ message: "Unknown bot provider" });
        if (bot.provider !== team.bot.provider && bot.apiKey === undefined) {
          // The saved key belongs to the old provider
          team.bot.apiKeyEnc = null;
          team.bot.apiKeyHint = null;
        }
        team.bot.provider = bot.provider;
      }
      if (bot.model !== undefined) team.bot.model = String(bot.model).trim();
      if (bot.apiKey !== undefined) {
        team.bot.apiKeyEnc = bot.apiKey ? encryptSecret(bot.apiKey.trim()) : null;
        team.bot.apiKeyHint = bot.apiKey ? secretHint(bot.apiKey.trim()) : null;
      }
    }

    if (lowPriorityLabels !== undefined) {
      const labels = (Array.isArray(lowPriorityLabels) ? lowPriorityLabels : String(lowPriorityLabels).split(","))
        .map((l) => String(l).trim())
        .filter(Boolean);
      team.lowPriorityLabels = labels;
    }

    // Verify the repo is reachable with the configured token before saving a new URL/token
    if (team.repo?.owner && (repoUrl !== undefined || githubToken !== undefined)) {
      const withSecrets = await Team.findById(team._id).select("+githubTokenEnc");
      const token = githubToken !== undefined
        ? (githubToken?.trim() || process.env.GITHUB_TOKEN)
        : (decryptSecret(withSecrets?.githubTokenEnc) || process.env.GITHUB_TOKEN);
      try {
        await gh(`/repos/${team.repo.owner}/${team.repo.name}`, { token });
      } catch (err) {
        return res.status(400).json({ message: err.message });
      }
    }

    await team.save();
    await team.populate([{ path: "leader", select: USER_FIELDS }, { path: "members", select: USER_FIELDS }]);
    await notifyTeam(team._id);
    res.json(toDto(team, req));
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ message: "A team with this name already exists" });
    console.error("updateTeam error:", err);
    res.status(500).json({ message: "Failed to update team" });
  }
};

// DELETE /api/teams/:id  (admin)
export const deleteTeam = async (req, res) => {
  try {
    const team = await Team.findByIdAndDelete(req.params.id);
    if (!team) return res.status(404).json({ message: "Team not found" });
    await BotTask.deleteMany({ team: team._id });
    res.json({ message: "Team deleted" });
  } catch (err) {
    console.error("deleteTeam error:", err);
    res.status(500).json({ message: "Failed to delete team" });
  }
};

// GET /api/teams/notices — issues + PRs from every team I belong to
export const getNotices = async (req, res) => {
  try {
    const teams = await Team.find(myTeamsQuery(req)).select("+githubTokenEnc").sort({ name: 1 });

    const results = await Promise.all(teams.map(async (team) => {
      const summary = {
        teamId: team._id,
        teamName: team.name,
        repo: team.repo?.owner ? team.repo : null,
        canManage: canManage(team, req),
        error: null,
        notices: [],
      };
      if (!summary.repo) return summary;

      try {
        const token = decryptSecret(team.githubTokenEnc) || process.env.GITHUB_TOKEN;
        const items = await getRepoNotices(team.repo, token);

        // Latest bot task per issue
        const tasks = await BotTask.find({ team: team._id }).sort({ createdAt: -1 }).lean();
        const latestTask = new Map();
        tasks.forEach((t) => { if (!latestTask.has(t.issueNumber)) latestTask.set(t.issueNumber, t); });

        summary.notices = items.map((item) => {
          const task = item.type === "issue" ? latestTask.get(item.number) : null;
          return {
            ...item,
            isLowPriority: item.type === "issue" && isLowPriority(item.labels, team.lowPriorityLabels),
            botTask: task
              ? {
                  _id: task._id,
                  status: task.status,
                  step: task.step,
                  prUrl: task.prUrl,
                  prNumber: task.prNumber,
                  error: task.error,
                  provider: task.provider,
                  updatedAt: task.updatedAt,
                }
              : null,
          };
        });
      } catch (err) {
        summary.error = err instanceof GitHubError ? err.message : "Failed to load GitHub data";
        if (!(err instanceof GitHubError)) console.error("getNotices team error:", err);
      }
      return summary;
    }));

    res.json({ teams: results });
  } catch (err) {
    console.error("getNotices error:", err);
    res.status(500).json({ message: "Failed to load notices" });
  }
};

// POST /api/teams/:id/bot/:issueNumber  (admin or team leader)
export const assignIssueToBot = async (req, res) => {
  try {
    const team = await Team.findById(req.params.id).select("+githubTokenEnc +bot.apiKeyEnc");
    if (!team) return res.status(404).json({ message: "Team not found" });
    if (!canManage(team, req)) return res.status(403).json({ message: "Only the team leader or an admin can assign issues to the bot" });
    if (!team.repo?.owner) return res.status(400).json({ message: "Link a GitHub repository first" });

    const issueNumber = Number(req.params.issueNumber);
    if (!Number.isInteger(issueNumber) || issueNumber <= 0) return res.status(400).json({ message: "Invalid issue number" });

    const providerConfig = LLM_PROVIDERS[team.bot.provider];
    if (!team.bot.apiKeyEnc && !process.env[providerConfig.envKey]) {
      return res.status(400).json({ message: `Add a ${providerConfig.label} API key in the team's bot settings first` });
    }
    const token = decryptSecret(team.githubTokenEnc) || process.env.GITHUB_TOKEN;
    if (!token) return res.status(400).json({ message: "Add a GitHub token with write access in the team settings first" });

    // Server-side check: must be an open, low-priority issue
    let issue;
    try {
      issue = await gh(`/repos/${team.repo.owner}/${team.repo.name}/issues/${issueNumber}`, { token });
    } catch (err) {
      return res.status(400).json({ message: err.message });
    }
    if (issue.pull_request) return res.status(400).json({ message: "That is a pull request, not an issue" });
    if (issue.state !== "open") return res.status(400).json({ message: "Issue is not open" });
    if (!isLowPriority(issue.labels || [], team.lowPriorityLabels)) {
      return res.status(400).json({ message: `Only low-priority issues can go to the bot (labels: ${team.lowPriorityLabels.join(", ")})` });
    }

    const existing = await BotTask.findOne({ team: team._id, issueNumber }).sort({ createdAt: -1 });
    if (existing && ["queued", "running"].includes(existing.status)) {
      return res.status(409).json({ message: "The bot is already working on this issue" });
    }
    if (existing?.status === "pr_opened" && !req.body?.force) {
      return res.status(409).json({ message: "The bot already opened a PR for this issue", prUrl: existing.prUrl });
    }

    const task = await BotTask.create({
      team: team._id,
      repo: `${team.repo.owner}/${team.repo.name}`,
      issueNumber,
      issueTitle: issue.title,
      provider: team.bot.provider,
      model: team.bot.model || providerConfig.defaultModel,
      requestedBy: req.userData.userId,
    });

    enqueueBotTask(task._id);
    await notifyTeam(team._id);
    res.status(202).json({ message: "Issue assigned to the bot", taskId: task._id });
  } catch (err) {
    console.error("assignIssueToBot error:", err);
    res.status(500).json({ message: "Failed to assign issue to bot" });
  }
};
