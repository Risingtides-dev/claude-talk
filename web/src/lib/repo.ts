import fs from "node:fs";
import path from "node:path";

export type RepoInfo = {
  /** Resolved (realpath'd) cwd of the session. */
  resolvedCwd: string;
  /** Topmost git dir for this cwd, e.g. /Users/me/dev/foo. Null if not a repo. */
  repoRoot: string | null;
  /** common dir if cwd is a worktree, used to dedupe sibling worktrees under one repo. */
  commonRepoRoot: string | null;
  /** True if cwd is a git worktree (i.e. .git is a file pointing at gitdir). */
  isWorktree: boolean;
  /** Pretty repo name (last segment of commonRepoRoot or repoRoot). */
  repoName: string | null;
  /** Folder name of the resolved cwd. Used as "worktree label" when it's a worktree. */
  folderName: string;
  /** github.com/owner/name parsed from origin remote. Null if not GitHub. */
  github: { url: string; owner: string; name: string } | null;
};

const cache = new Map<string, { value: RepoInfo; mtime: number }>();

function readSafe(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

/** Walk upward to find the directory that contains a .git entry. */
function findGitDir(start: string): { dir: string; gitEntry: string } | null {
  let cur = start;
  for (let i = 0; i < 30; i++) {
    const g = path.join(cur, ".git");
    if (fs.existsSync(g)) return { dir: cur, gitEntry: g };
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
  return null;
}

/** Resolve the common git dir for a worktree by reading the gitdir pointer. */
function resolveCommonGitDir(gitEntry: string): {
  isWorktree: boolean;
  commonRoot: string | null;
} {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(gitEntry);
  } catch {
    return { isWorktree: false, commonRoot: null };
  }
  if (stat.isDirectory()) return { isWorktree: false, commonRoot: null };
  // Worktree: .git is a file containing "gitdir: /path/to/main/.git/worktrees/<name>"
  const txt = readSafe(gitEntry) ?? "";
  const m = txt.match(/^gitdir:\s*(.+)$/m);
  if (!m) return { isWorktree: false, commonRoot: null };
  const wtGitDir = m[1].trim();
  // commondir lives one or two levels up: <main-git-dir>/worktrees/<name>/commondir
  // and contains a relative path back to the main .git directory.
  const commonFile = path.join(wtGitDir, "commondir");
  const rel = readSafe(commonFile);
  if (!rel) {
    // Fallback: assume <wtGitDir>/../../ is main .git, and parent is repo root.
    const guessed = path.dirname(path.dirname(wtGitDir));
    return {
      isWorktree: true,
      commonRoot: fs.existsSync(guessed) ? guessed : null,
    };
  }
  const mainGitDir = path.resolve(wtGitDir, rel.trim());
  const root = path.dirname(mainGitDir);
  return { isWorktree: true, commonRoot: root };
}

function parseGithub(remoteUrl: string): RepoInfo["github"] {
  // Match git@github.com:owner/name(.git)? OR https://github.com/owner/name(.git)?
  const ssh = remoteUrl.match(/^git@github\.com:([^/]+)\/([^/.]+?)(?:\.git)?$/);
  const https = remoteUrl.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/.]+?)(?:\.git)?\/?$/,
  );
  const m = ssh ?? https;
  if (!m) return null;
  const owner = m[1];
  const name = m[2];
  return { url: `https://github.com/${owner}/${name}`, owner, name };
}

function parseRemoteFromConfig(configText: string): string | null {
  // [remote "origin"]\n  url = ...
  const block = configText.match(
    /\[remote\s+"origin"\][^\[]*?url\s*=\s*([^\s\n]+)/,
  );
  return block ? block[1] : null;
}

/** Read repo info for a cwd. Cached by realpath + git config mtime. */
export function repoInfo(cwd: string): RepoInfo {
  let resolved = cwd;
  try {
    resolved = fs.realpathSync.native(cwd);
  } catch {
    /* keep original */
  }

  const folderName = path.basename(resolved);

  const cached = cache.get(resolved);
  const found = findGitDir(resolved);
  if (!found) {
    const value: RepoInfo = {
      resolvedCwd: resolved,
      repoRoot: null,
      commonRepoRoot: null,
      isWorktree: false,
      repoName: null,
      folderName,
      github: null,
    };
    return value;
  }

  // Cache key includes mtime of config so we re-read when remote changes.
  const configPath = path.join(found.gitEntry, "config");
  let mtime = 0;
  try {
    if (fs.statSync(found.gitEntry).isDirectory()) {
      mtime = fs.statSync(configPath).mtimeMs;
    } else {
      const wt = resolveCommonGitDir(found.gitEntry);
      if (wt.commonRoot) {
        const cfg = path.join(wt.commonRoot, ".git", "config");
        mtime = fs.statSync(cfg).mtimeMs;
      }
    }
  } catch {
    /* ignore */
  }
  if (cached && cached.mtime === mtime) return cached.value;

  const wt = resolveCommonGitDir(found.gitEntry);
  const commonRepoRoot = wt.commonRoot ?? found.dir;
  const repoRoot = found.dir;

  const cfgPath = wt.isWorktree
    ? path.join(commonRepoRoot, ".git", "config")
    : path.join(repoRoot, ".git", "config");
  const cfg = readSafe(cfgPath) ?? "";
  const remoteUrl = parseRemoteFromConfig(cfg);
  const github = remoteUrl ? parseGithub(remoteUrl) : null;
  const repoName = path.basename(commonRepoRoot);

  const value: RepoInfo = {
    resolvedCwd: resolved,
    repoRoot,
    commonRepoRoot,
    isWorktree: wt.isWorktree,
    repoName,
    folderName,
    github,
  };
  cache.set(resolved, { value, mtime });
  return value;
}
