export function relativeTime(ms: number | undefined): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return "just now";
  if (diff < hour) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  const date = new Date(ms);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function projectNameFromCwd(cwd: string | undefined): string {
  if (!cwd) return "—";
  const parts = cwd.split("/").filter(Boolean);
  if (parts.length === 0) return cwd;
  const last = parts[parts.length - 1];
  if (last === "claude") return parts[parts.length - 2] ?? last;
  if (last.match(/^worktree[-_]/i) || parts[parts.length - 2] === "worktrees") {
    return `${parts[parts.length - 3] ?? "?"} · ${last}`;
  }
  return last;
}

export function truncate(s: string | undefined, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}
