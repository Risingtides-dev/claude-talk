"use client";

import { useEffect, useState } from "react";

type Entry = {
  name: string;
  path: string;
  kind: "dir" | "file";
  size?: number;
  mtime?: number;
};

type ListResp = {
  cwd: string;
  parent: string | null;
  entries: Entry[];
  error?: string;
};

export function FilePicker({
  startDir,
  onPick,
  onClose,
}: {
  startDir?: string;
  onPick: (absPath: string) => void;
  onClose: () => void;
}) {
  const [cwd, setCwd] = useState<string | null>(startDir ?? null);
  const [data, setData] = useState<ListResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    const url = cwd
      ? `/api/fs/list?dir=${encodeURIComponent(cwd)}`
      : `/api/fs/list`;
    fetch(url)
      .then((r) => r.json())
      .then((j: ListResp) => {
        if (cancelled) return;
        if (j.error) setErr(j.error);
        else {
          setData(j);
          setCwd(j.cwd);
        }
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  const segments = (data?.cwd ?? "").split("/").filter(Boolean);

  return (
    <div
      className="overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="panel" role="dialog" aria-label="Pick a file">
        <div className="head">
          <button className="close" onClick={onClose} aria-label="Close">
            ×
          </button>
          <div className="crumbs">
            <button
              className="crumb"
              onClick={() => setCwd(null)}
              title="Home"
            >
              ~
            </button>
            {segments.map((seg, i) => {
              const p = "/" + segments.slice(0, i + 1).join("/");
              return (
                <button
                  key={p}
                  className="crumb"
                  onClick={() => setCwd(p)}
                  title={p}
                >
                  / {seg}
                </button>
              );
            })}
          </div>
        </div>
        <div className="list">
          {loading && <div className="muted">Loading…</div>}
          {err && <div className="error">{err}</div>}
          {!loading && data?.parent && (
            <button
              className="row dir"
              onClick={() => setCwd(data.parent!)}
            >
              <span className="icon">↑</span>
              <span className="name">..</span>
            </button>
          )}
          {!loading &&
            data?.entries.map((e) => (
              <button
                key={e.path}
                className={`row ${e.kind}`}
                onClick={() =>
                  e.kind === "dir" ? setCwd(e.path) : onPick(e.path)
                }
                title={e.path}
              >
                <span className="icon">{e.kind === "dir" ? "▸" : "·"}</span>
                <span className="name">{e.name}</span>
                {e.kind === "file" && (
                  <span className="size">{prettySize(e.size)}</span>
                )}
              </button>
            ))}
        </div>
      </div>
      <style jsx>{`
        .overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.55);
          z-index: 50;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
        }
        .panel {
          background: hsl(var(--bg-200));
          border-radius: var(--radius-lg);
          width: min(560px, 100%);
          max-height: 80dvh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
        }
        .head {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 12px;
          border-bottom: 1px solid hsl(var(--border-300) / 0.12);
        }
        .close {
          width: 28px;
          height: 28px;
          font-size: 18px;
          color: hsl(var(--text-300));
          border-radius: 50%;
          flex-shrink: 0;
        }
        .close:hover {
          background: hsl(var(--bg-300));
        }
        .crumbs {
          display: flex;
          flex-wrap: wrap;
          gap: 0;
          font-family: var(--font-mono);
          font-size: 12px;
          color: hsl(var(--text-400));
          overflow: hidden;
        }
        .crumb {
          padding: 2px 4px;
          color: hsl(var(--text-300));
          border-radius: 3px;
        }
        .crumb:hover {
          background: hsl(var(--bg-300));
        }
        .list {
          overflow-y: auto;
          padding: 4px;
        }
        .muted {
          padding: 16px 12px;
          color: hsl(var(--text-400));
          font-size: 13px;
        }
        .error {
          padding: 16px 12px;
          color: hsl(var(--danger-100));
          font-size: 13px;
        }
        .row {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 8px 10px;
          font-size: 13px;
          color: hsl(var(--text-100));
          text-align: left;
          border-radius: var(--radius-md);
        }
        .row:hover {
          background: hsl(var(--bg-300));
        }
        .row.dir {
          color: hsl(var(--text-100));
          font-weight: 500;
        }
        .icon {
          width: 18px;
          color: hsl(var(--text-400));
          flex-shrink: 0;
        }
        .name {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .size {
          color: hsl(var(--text-400));
          font-size: 11px;
          font-family: var(--font-mono);
        }
      `}</style>
    </div>
  );
}

function prettySize(n: number | undefined): string {
  if (n === undefined) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
