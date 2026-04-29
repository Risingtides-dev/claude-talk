import { NextResponse } from "next/server";
import { listAllSessions } from "@/lib/sessions";
import { repoInfo } from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function GET() {
  const sessions = await listAllSessions();
  // Enrich each session with resolved repo metadata so the sidebar can show
  // real folder names, branch + worktree info, and a github link.
  const enriched = sessions.map((s) => {
    if (!s.cwd) return s;
    try {
      const r = repoInfo(s.cwd);
      return {
        ...s,
        resolvedCwd: r.resolvedCwd,
        repoRoot: r.repoRoot,
        commonRepoRoot: r.commonRepoRoot,
        isWorktree: r.isWorktree,
        repoName: r.repoName,
        folderName: r.folderName,
        github: r.github,
      };
    } catch {
      return s;
    }
  });
  return NextResponse.json({ sessions: enriched });
}
