import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const HOME = os.homedir();

export type FsEntry = {
  name: string;
  path: string;
  kind: "dir" | "file";
  size?: number;
  mtime?: number;
};

/** Resolve and validate that target is inside the user's home directory. */
function safeResolve(target: string): string {
  let resolved = path.resolve(target);
  try {
    resolved = fs.realpathSync.native(resolved);
  } catch {
    /* fall through with raw resolved */
  }
  if (resolved !== HOME && !resolved.startsWith(HOME + path.sep)) {
    throw new Error("Path outside home directory");
  }
  return resolved;
}

export type ListResult = {
  cwd: string;
  parent: string | null;
  entries: FsEntry[];
};

/** List the immediate children of `dir`, hiding dotfiles by default. */
export function listDir(dir: string, opts?: { showHidden?: boolean }): ListResult {
  const target = safeResolve(dir);
  const showHidden = opts?.showHidden === true;

  let raw: fs.Dirent[];
  try {
    raw = fs.readdirSync(target, { withFileTypes: true });
  } catch (err) {
    throw new Error(`Cannot read ${target}: ${(err as Error).message}`);
  }

  const entries: FsEntry[] = [];
  for (const d of raw) {
    if (!showHidden && d.name.startsWith(".")) continue;
    const p = path.join(target, d.name);
    let size: number | undefined;
    let mtime: number | undefined;
    try {
      const st = fs.statSync(p);
      size = st.isFile() ? st.size : undefined;
      mtime = st.mtimeMs;
    } catch {
      /* skip */
    }
    entries.push({
      name: d.name,
      path: p,
      kind: d.isDirectory() ? "dir" : "file",
      size,
      mtime,
    });
  }

  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const parent = target === HOME ? null : path.dirname(target);
  return { cwd: target, parent, entries };
}
