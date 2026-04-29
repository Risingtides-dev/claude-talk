import fs from "node:fs";
import {
  listSessions,
  getSessionMessages,
  type SDKSessionInfo,
  type SessionMessage,
} from "@anthropic-ai/claude-agent-sdk";

export function canonicalCwd(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return p;
  }
}

export type ProjectSummary = {
  encodedDir: string;
  cwd: string;
  sessionCount: number;
  lastModified: number;
};

export async function listProjects(): Promise<ProjectSummary[]> {
  const sessions = await listSessions();
  const byEncoded = new Map<string, ProjectSummary>();
  for (const s of sessions) {
    if (!s.cwd) continue;
    const encoded = s.cwd.replace(/[^a-zA-Z0-9]/g, "-");
    const existing = byEncoded.get(encoded);
    if (existing) {
      existing.sessionCount++;
      if ((s.lastModified ?? 0) > existing.lastModified) {
        existing.lastModified = s.lastModified ?? 0;
      }
    } else {
      byEncoded.set(encoded, {
        encodedDir: encoded,
        cwd: s.cwd,
        sessionCount: 1,
        lastModified: s.lastModified ?? 0,
      });
    }
  }
  return Array.from(byEncoded.values()).sort(
    (a, b) => b.lastModified - a.lastModified,
  );
}

export type SessionListItem = SDKSessionInfo;

export async function listAllSessions(): Promise<SessionListItem[]> {
  const all = await listSessions();
  all.sort((a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0));
  return all;
}

export async function readSession(
  sessionId: string,
  cwd: string,
): Promise<SessionMessage[]> {
  return getSessionMessages(sessionId, { dir: canonicalCwd(cwd) });
}
