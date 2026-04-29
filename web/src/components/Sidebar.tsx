"use client";

import { useEffect, useMemo, useState } from "react";
import { projectNameFromCwd, relativeTime, truncate } from "@/lib/format";

type Session = {
  sessionId: string;
  summary?: string;
  firstPrompt?: string;
  lastModified?: number;
  createdAt?: number;
  cwd?: string;
  fileSize?: number;
  gitBranch?: string;
  // Repo enrichment from /api/sessions
  resolvedCwd?: string;
  repoRoot?: string | null;
  commonRepoRoot?: string | null;
  isWorktree?: boolean;
  repoName?: string | null;
  folderName?: string;
  github?: { url: string; owner: string; name: string } | null;
};

function projectLabel(s: Session): string {
  if (s.repoName) return s.repoName;
  if (s.folderName) return s.folderName;
  return projectNameFromCwd(s.cwd);
}

function worktreeLabel(s: Session): string | null {
  if (!s.isWorktree) return null;
  if (s.folderName && s.folderName !== s.repoName) return s.folderName;
  return null;
}

type SortMode = "date" | "project";

export function Sidebar({
  activeSessionId,
  onSelect,
}: {
  activeSessionId?: string;
  onSelect: (s: Session) => void;
}) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortMode>("date");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    const stored = localStorage.getItem("sortMode");
    if (stored === "date" || stored === "project") setSort(stored);
  }, []);

  useEffect(() => {
    localStorage.setItem("sortMode", sort);
  }, [sort]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch("/api/sessions");
        const j = await r.json();
        if (!cancelled) {
          setSessions(j.sessions ?? []);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const filtered = useMemo(() => {
    if (!filter.trim()) return sessions;
    const q = filter.toLowerCase();
    return sessions.filter(
      (s) =>
        s.summary?.toLowerCase().includes(q) ||
        s.firstPrompt?.toLowerCase().includes(q) ||
        s.cwd?.toLowerCase().includes(q),
    );
  }, [sessions, filter]);

  const grouped = useMemo(() => {
    if (sort === "date") return null;
    // Group by repo root if available so all worktrees of the same repo
    // collapse under one project header. Falls back to cwd for non-git dirs.
    const map = new Map<string, Session[]>();
    for (const s of filtered) {
      const key = s.commonRepoRoot ?? s.repoRoot ?? s.cwd ?? "—";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return Array.from(map.entries()).sort((a, b) => {
      const aMax = Math.max(...a[1].map((s) => s.lastModified ?? 0));
      const bMax = Math.max(...b[1].map((s) => s.lastModified ?? 0));
      return bMax - aMax;
    });
  }, [filtered, sort]);

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand">Claude Talk</div>
        <div className="sort-toggle" role="tablist">
          <button
            role="tab"
            aria-selected={sort === "date"}
            className={sort === "date" ? "on" : ""}
            onClick={() => setSort("date")}
          >
            Date
          </button>
          <button
            role="tab"
            aria-selected={sort === "project"}
            className={sort === "project" ? "on" : ""}
            onClick={() => setSort("project")}
          >
            Project
          </button>
        </div>
        <input
          className="filter"
          placeholder="Filter sessions…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className="sidebar-list">
        {loading && <div className="empty">Loading…</div>}
        {!loading && filtered.length === 0 && (
          <div className="empty">No sessions{filter ? " match" : " yet"}</div>
        )}

        {!loading && sort === "date" &&
          filtered.map((s) => (
            <Row
              key={s.sessionId}
              session={s}
              active={s.sessionId === activeSessionId}
              onSelect={onSelect}
            />
          ))}

        {!loading && sort === "project" &&
          grouped?.map(([key, list]) => {
            const head = list[0];
            const label = projectLabel(head);
            const gh = head.github;
            return (
              <div key={key} className="group">
                <div className="group-head">
                  <span>{label}</span>
                  {gh && (
                    <a
                      className="gh"
                      href={gh.url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      title={`${gh.owner}/${gh.name} on GitHub`}
                    >
                      ↗
                    </a>
                  )}
                </div>
                {list.map((s) => (
                  <Row
                    key={s.sessionId}
                    session={s}
                    active={s.sessionId === activeSessionId}
                    onSelect={onSelect}
                    hideProject
                  />
                ))}
              </div>
            );
          })}
      </div>

      <style jsx>{`
        @media (max-width: 760px) {
          .sidebar { width: 100% !important; }
        }
        .sidebar {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: var(--sidebar-w);
          background: hsl(var(--bg-200));
          border-right: 1px solid hsl(var(--border-300) / 0.12);
        }
        .sidebar-head {
          padding: 14px 12px 10px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          border-bottom: 1px solid hsl(var(--border-300) / 0.1);
        }
        .brand {
          font-size: 13px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: hsl(var(--text-400));
          padding: 0 4px;
        }
        .sort-toggle {
          display: flex;
          gap: 0;
          background: hsl(var(--bg-300) / 0.6);
          border-radius: var(--radius-md);
          padding: 2px;
        }
        .sort-toggle button {
          flex: 1;
          padding: 4px 8px;
          font-size: 12px;
          color: hsl(var(--text-400));
          border-radius: 4px;
          transition: all var(--dur-fast) var(--ease);
        }
        .sort-toggle button.on {
          background: hsl(var(--bg-000));
          color: hsl(var(--text-100));
          box-shadow: 0 1px 2px hsl(var(--border-300) / 0.15);
        }
        .filter {
          padding: 6px 10px;
          font-size: 13px;
          background: hsl(var(--bg-300) / 0.5);
          border-radius: var(--radius-md);
          color: hsl(var(--text-100));
        }
        .filter::placeholder {
          color: hsl(var(--text-400));
        }
        .sidebar-list {
          flex: 1;
          overflow-y: auto;
          padding: 4px 6px 24px;
        }
        .empty {
          padding: 24px 12px;
          color: hsl(var(--text-400));
          font-size: 13px;
        }
        .group {
          margin-top: 12px;
        }
        .group-head {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: hsl(var(--text-400));
          padding: 8px 10px 4px;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .group-head .gh {
          color: hsl(var(--text-400));
          text-decoration: none;
          font-size: 11px;
          padding: 0 4px;
          border-radius: 3px;
          transition: color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
        }
        .group-head .gh:hover {
          color: hsl(var(--clay));
          background: hsl(var(--bg-300) / 0.6);
        }
      `}</style>
    </aside>
  );
}

function Row({
  session,
  active,
  onSelect,
  hideProject,
}: {
  session: Session;
  active: boolean;
  onSelect: (s: Session) => void;
  hideProject?: boolean;
}) {
  const title =
    session.summary ?? session.firstPrompt ?? `Session ${session.sessionId.slice(0, 8)}`;
  return (
    <button
      className={`row ${active ? "active" : ""}`}
      onClick={() => onSelect(session)}
    >
      <div className="title">{truncate(title, 64)}</div>
      <div className="meta">
        {!hideProject && (
          <span className="project">{projectLabel(session)}</span>
        )}
        {worktreeLabel(session) && (
          <span className="worktree">· {worktreeLabel(session)}</span>
        )}
        {session.gitBranch && (
          <span className="branch" title={`Branch ${session.gitBranch}`}>
            ⎇ {session.gitBranch}
          </span>
        )}
        <span className="time" suppressHydrationWarning>
          {relativeTime(session.lastModified)}
        </span>
      </div>
      <style jsx>{`
        .row {
          display: flex;
          flex-direction: column;
          gap: 3px;
          width: 100%;
          padding: 8px 10px;
          text-align: left;
          border-radius: var(--radius-md);
          color: hsl(var(--text-100));
          transition: background var(--dur-fast) var(--ease);
          position: relative;
        }
        .row:hover {
          background: hsl(var(--bg-300) / 0.7);
        }
        .row.active {
          background: hsl(var(--bg-400) / 0.8);
        }
        .row.active::before {
          content: "";
          position: absolute;
          left: 0;
          top: 6px;
          bottom: 6px;
          width: 2px;
          border-radius: 1px;
          background: hsl(var(--clay));
        }
        .title {
          font-size: 13px;
          line-height: 1.35;
          color: hsl(var(--text-100));
        }
        .meta {
          display: flex;
          gap: 8px;
          font-size: 11px;
          color: hsl(var(--text-400));
          align-items: center;
        }
        .project {
          color: hsl(var(--text-300));
          font-weight: 500;
        }
        .worktree {
          color: hsl(var(--text-400));
        }
        .branch {
          color: hsl(var(--text-400));
          font-family: var(--font-mono);
          font-size: 10.5px;
          padding: 1px 5px;
          background: hsl(var(--bg-300) / 0.6);
          border-radius: 3px;
        }
        .time {
          margin-left: auto;
        }
        @media (max-width: 760px) {
          .row {
            padding: 7px 10px;
          }
          .title {
            font-size: 12.5px;
          }
          .meta {
            font-size: 10.5px;
            gap: 6px;
          }
          .worktree,
          .branch {
            display: none;
          }
        }
      `}</style>
    </button>
  );
}
