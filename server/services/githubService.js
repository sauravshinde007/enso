// server/services/githubService.js
// Thin GitHub REST client: notice-board reads (cached) + the git-data writes the bot needs.

const GITHUB_API = "https://api.github.com";
const NOTICE_CACHE_TTL_MS = 60 * 1000;
const noticeCache = new Map(); // "owner/name" -> { at, data }

export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Accepts https://github.com/owner/repo(.git)(/anything), git@github.com:owner/repo.git or owner/repo
 */
export const parseRepoUrl = (input) => {
  if (!input || typeof input !== "string") return null;
  const value = input.trim();
  const match =
    value.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#].*)?$/i) ||
    value.match(/^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i) ||
    value.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!match) return null;
  const [, owner, name] = match;
  return { owner, name, url: `https://github.com/${owner}/${name}` };
};

export const gh = async (path, { token, method = "GET", body, accept } = {}) => {
  const headers = {
    Accept: accept || "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "2D-Metaverse-NoticeBoard",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";

  const res = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = await res.json();
      message = data.message || message;
    } catch { /* non-JSON error body */ }
    if (res.status === 403 && /rate limit/i.test(message)) {
      message = "GitHub rate limit reached. Add a GitHub token to the team to raise the limit.";
    } else if (res.status === 404) {
      message = "Repository not found (or it is private and the team has no GitHub token with access).";
    }
    throw new GitHubError(res.status, message);
  }

  if (res.status === 204) return null;
  const contentType = res.headers.get("content-type") || "";
  return contentType.includes("json") ? res.json() : res.text();
};

const mapItem = (item, type) => ({
  type, // 'issue' | 'pr'
  number: item.number,
  title: item.title,
  url: item.html_url,
  author: item.user?.login || "unknown",
  authorAvatar: item.user?.avatar_url || null,
  labels: (item.labels || []).map((l) => ({ name: l.name, color: l.color })),
  comments: item.comments ?? null,
  draft: !!item.draft,
  createdAt: item.created_at,
  updatedAt: item.updated_at,
});

/** Open issues + open PRs for a repo (cached briefly to stay under GitHub rate limits). */
export const getRepoNotices = async (repo, token) => {
  const key = `${repo.owner}/${repo.name}`.toLowerCase();
  const cached = noticeCache.get(key);
  if (cached && Date.now() - cached.at < NOTICE_CACHE_TTL_MS) return cached.data;

  const base = `/repos/${repo.owner}/${repo.name}`;
  const [issues, pulls] = await Promise.all([
    gh(`${base}/issues?state=open&sort=updated&per_page=50`, { token }),
    gh(`${base}/pulls?state=open&sort=updated&per_page=30`, { token }),
  ]);

  const data = [
    // The issues endpoint also returns PRs; those come from /pulls instead
    ...issues.filter((i) => !i.pull_request).map((i) => mapItem(i, "issue")),
    ...pulls.map((p) => mapItem(p, "pr")),
  ];
  noticeCache.set(key, { at: Date.now(), data });
  return data;
};

export const invalidateRepoNotices = (repo) => {
  noticeCache.delete(`${repo.owner}/${repo.name}`.toLowerCase());
};

export const isLowPriority = (labels, lowPriorityLabels) => {
  const wanted = new Set((lowPriorityLabels || []).map((l) => l.trim().toLowerCase()));
  return labels.some((l) => wanted.has(String(l.name || l).trim().toLowerCase()));
};
