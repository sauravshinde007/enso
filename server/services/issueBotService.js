// server/services/issueBotService.js
// AI bot that turns a low-priority GitHub issue into a pull request.
// Everything goes through the GitHub REST API (no clone, no code execution on this server):
//   issue + file tree -> model picks files -> model writes changes -> blobs/tree/commit -> branch -> PR
import Team from "../models/Team.js";
import BotTask from "../models/BotTask.js";
import User from "../models/User.js";
import { gh, invalidateRepoNotices } from "./githubService.js";
import { completeJson, resolveLlmConfig } from "./llmService.js";
import { decryptSecret } from "../utils/secrets.js";

const MAX_FILES_TO_READ = 8;
const MAX_FILES_TO_CHANGE = 10;
const MAX_FILE_BYTES = 100 * 1024;
const MAX_TREE_PATHS = 1500;

const SKIP_PATH = /(^|\/)(node_modules|dist|build|out|coverage|vendor|\.git|\.next|\.cache)(\/|$)|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/i;
const TEXT_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|json|md|mdx|txt|css|scss|less|html|vue|svelte|py|rb|go|rs|java|kt|cs|cpp|cc|c|h|hpp|php|swift|sh|yml|yaml|toml|ini|env\.example|sql|graphql|prisma)$/i;

let io = null;
let queue = Promise.resolve();

export const initIssueBot = (socketIo) => {
  io = socketIo;
};

/** Tell every online member of the team to refresh their notice board */
export const notifyTeam = async (teamId) => {
  if (!io) return;
  try {
    const team = await Team.findById(teamId).select("leader members");
    if (!team) return;
    const users = await User.find({ _id: { $in: [team.leader, ...team.members] } }).select("activeSocketId");
    users.forEach((u) => {
      if (u.activeSocketId) io.to(u.activeSocketId).emit("noticeBoardUpdate", { teamId: String(teamId) });
    });
  } catch (err) {
    console.error("notifyTeam failed:", err.message);
  }
};

/** Tasks interrupted by a server restart can never finish; mark them failed. */
export const recoverStaleBotTasks = async () => {
  const res = await BotTask.updateMany(
    { status: { $in: ["queued", "running"] } },
    { status: "failed", error: "Interrupted by a server restart. Please retry.", step: "Failed" }
  );
  if (res.modifiedCount) console.log(`🤖 Marked ${res.modifiedCount} interrupted bot task(s) as failed`);
};

/** Run tasks one at a time so we don't hammer GitHub / the LLM API. */
export const enqueueBotTask = (taskId) => {
  queue = queue.then(() => runBotTask(taskId)).catch((err) => console.error("Bot queue error:", err));
};

const updateTask = async (task, fields) => {
  Object.assign(task, fields);
  await task.save();
  await notifyTeam(task.team);
};

const SYSTEM_PROMPT = `You are an autonomous software engineer fixing a GitHub issue.
Make the smallest correct change that resolves the issue, matching the existing code style.
Never invent files you have not been shown unless the fix genuinely requires a new file.
Always reply with a single JSON object and nothing else.`;

const runBotTask = async (taskId) => {
  const task = await BotTask.findById(taskId);
  if (!task || task.status !== "queued") return;

  try {
    await updateTask(task, { status: "running", step: "Reading issue" });

    const team = await Team.findById(task.team).select("+githubTokenEnc +bot.apiKeyEnc");
    if (!team?.repo?.owner) throw new Error("Team has no GitHub repository linked");

    const token = decryptSecret(team.githubTokenEnc) || process.env.GITHUB_TOKEN;
    if (!token) throw new Error("A GitHub token with write access is required to open PRs. Add one in the team settings.");

    const llm = {
      provider: team.bot.provider,
      model: team.bot.model,
      apiKey: decryptSecret(team.bot.apiKeyEnc),
    };
    const { config: llmConfig } = resolveLlmConfig(llm); // fail early on missing key

    const base = `/repos/${team.repo.owner}/${team.repo.name}`;
    const repoInfo = await gh(base, { token });
    if (repoInfo.permissions && !repoInfo.permissions.push) {
      throw new Error("The team's GitHub token has no write (push) access to this repository");
    }
    const defaultBranch = repoInfo.default_branch;

    const issue = await gh(`${base}/issues/${task.issueNumber}`, { token });
    if (issue.pull_request) throw new Error("This number is a pull request, not an issue");
    const comments = issue.comments
      ? await gh(`${base}/issues/${task.issueNumber}/comments?per_page=10`, { token })
      : [];

    const issueText = [
      `#${issue.number}: ${issue.title}`,
      "",
      issue.body || "(no description)",
      ...comments.map((c) => `\n--- comment by ${c.user?.login} ---\n${c.body}`),
    ].join("\n").slice(0, 8000);

    // 1. Repository file list
    await updateTask(task, { step: "Scanning repository" });
    const branchRef = await gh(`${base}/git/ref/heads/${encodeURIComponent(defaultBranch)}`, { token });
    const baseCommitSha = branchRef.object.sha;
    const baseCommit = await gh(`${base}/git/commits/${baseCommitSha}`, { token });
    const tree = await gh(`${base}/git/trees/${baseCommit.tree.sha}?recursive=1`, { token });

    const blobPaths = new Set(tree.tree.filter((e) => e.type === "blob").map((e) => e.path));
    const candidates = tree.tree
      .filter((e) => e.type === "blob" && e.size <= MAX_FILE_BYTES && !SKIP_PATH.test(e.path) && TEXT_EXT.test(e.path))
      .map((e) => e.path)
      .slice(0, MAX_TREE_PATHS);
    if (candidates.length === 0) throw new Error("No readable source files found in the repository");

    // 2. Let the model pick which files it needs
    await updateTask(task, { step: "Choosing relevant files" });
    const pathBudget = Math.floor(llmConfig.contextChars * 0.5);
    let pathList = candidates.join("\n");
    if (pathList.length > pathBudget) pathList = pathList.slice(0, pathBudget);

    const selection = await completeJson({
      ...llm,
      system: SYSTEM_PROMPT,
      prompt: `Repository: ${team.repo.owner}/${team.repo.name}

Issue:
${issueText}

Files in the repository:
${pathList}

Which files must be read (and possibly edited) to fix this issue? Pick at most ${MAX_FILES_TO_READ}.
Reply as JSON: {"files": ["path/one", "path/two"]}`,
    });

    const chosen = (Array.isArray(selection.files) ? selection.files : [])
      .filter((p) => typeof p === "string" && blobPaths.has(p))
      .slice(0, MAX_FILES_TO_READ);

    // 3. Read the chosen files (within the provider's context budget)
    await updateTask(task, { step: `Reading ${chosen.length} file(s)` });
    const fileBudget = llmConfig.contextChars;
    let used = 0;
    const files = [];
    for (const path of chosen) {
      const content = await gh(`${base}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(defaultBranch)}`, {
        token,
        accept: "application/vnd.github.raw+json",
      });
      const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
      if (used + text.length > fileBudget) break;
      used += text.length;
      files.push({ path, content: text });
    }

    // 4. Ask for the actual change
    await updateTask(task, { step: "Writing the fix" });
    const fileSection = files.length
      ? files.map((f) => `===== FILE: ${f.path} =====\n${f.content}`).join("\n\n")
      : "(no existing files were selected)";

    const plan = await completeJson({
      ...llm,
      system: SYSTEM_PROMPT,
      prompt: `Repository: ${team.repo.owner}/${team.repo.name}

Issue:
${issueText}

Current file contents:
${fileSection}

Fix the issue. For every file you change, return its COMPLETE new content (not a diff).
Reply as JSON:
{
  "pr_title": "short imperative title",
  "pr_body": "what changed and why (markdown)",
  "changes": [
    {"path": "path/to/file", "action": "update" | "create" | "delete", "content": "full new file content"}
  ]
}
At most ${MAX_FILES_TO_CHANGE} changes. If the issue cannot be fixed from this information, return "changes": [] and explain in pr_body.`,
    });

    const changes = (Array.isArray(plan.changes) ? plan.changes : [])
      .filter((c) => c && typeof c.path === "string" && !c.path.startsWith("/") && !c.path.includes(".."))
      .filter((c) => (c.action === "delete" ? blobPaths.has(c.path) : typeof c.content === "string"))
      .slice(0, MAX_FILES_TO_CHANGE);

    if (changes.length === 0) {
      throw new Error(`The bot could not produce a change. ${String(plan.pr_body || "").slice(0, 300)}`);
    }

    // 5. Commit to a new branch via the git data API
    await updateTask(task, { step: "Committing changes" });
    const treeEntries = [];
    for (const change of changes) {
      if (change.action === "delete") {
        treeEntries.push({ path: change.path, mode: "100644", type: "blob", sha: null });
      } else {
        const blob = await gh(`${base}/git/blobs`, {
          token,
          method: "POST",
          body: { content: change.content, encoding: "utf-8" },
        });
        treeEntries.push({ path: change.path, mode: "100644", type: "blob", sha: blob.sha });
      }
    }

    const newTree = await gh(`${base}/git/trees`, {
      token,
      method: "POST",
      body: { base_tree: baseCommit.tree.sha, tree: treeEntries },
    });
    const commitTitle = String(plan.pr_title || `Fix #${issue.number}: ${issue.title}`).slice(0, 120);
    const commit = await gh(`${base}/git/commits`, {
      token,
      method: "POST",
      body: {
        message: `${commitTitle}\n\nAutomated fix for #${issue.number} by the notice-board bot (${llmConfig.label}).`,
        tree: newTree.sha,
        parents: [baseCommitSha],
      },
    });

    const branch = `ai-bot/issue-${issue.number}-${Date.now().toString(36)}`;
    await gh(`${base}/git/refs`, {
      token,
      method: "POST",
      body: { ref: `refs/heads/${branch}`, sha: commit.sha },
    });

    // 6. Open the PR and link it from the issue
    await updateTask(task, { step: "Opening pull request", branch });
    const pr = await gh(`${base}/pulls`, {
      token,
      method: "POST",
      body: {
        title: commitTitle,
        head: branch,
        base: defaultBranch,
        body: `${plan.pr_body || ""}\n\nCloses #${issue.number}\n\n---\n🤖 Generated by the notice-board bot using ${llmConfig.label} (\`${llm.model || llmConfig.defaultModel}\`). Please review carefully before merging.`,
      },
    });

    await gh(`${base}/issues/${issue.number}/comments`, {
      token,
      method: "POST",
      body: { body: `🤖 The notice-board bot opened a pull request for this issue: ${pr.html_url}` },
    }).catch((err) => console.warn("Could not comment on issue:", err.message));

    invalidateRepoNotices(team.repo);
    await updateTask(task, {
      status: "pr_opened",
      step: "Pull request opened",
      prNumber: pr.number,
      prUrl: pr.html_url,
      error: null,
    });
    console.log(`🤖 Bot opened PR ${pr.html_url} for ${task.repo}#${task.issueNumber}`);
  } catch (err) {
    console.error(`🤖 Bot task ${taskId} failed:`, err.message);
    await updateTask(task, { status: "failed", step: "Failed", error: String(err.message).slice(0, 500) });
  }
};
