import { NextRequest } from "next/server";
import { runChatTurn, type ChatEvent } from "@/lib/chat";
import { canonicalCwd } from "@/lib/sessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PermissionMode =
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "plan"
  | "dontAsk"
  | "auto";

const VALID_MODES: PermissionMode[] = [
  "default",
  "acceptEdits",
  "bypassPermissions",
  "plan",
  "dontAsk",
  "auto",
];

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { sessionId, cwd, prompt, source, permissionMode } = body as {
    sessionId?: string;
    cwd: string;
    prompt: string;
    source?: "text" | "voice";
    permissionMode?: string;
  };

  if (!cwd || !prompt) {
    return new Response(
      JSON.stringify({ error: "cwd and prompt required" }),
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: ChatEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      };
      const ac = new AbortController();
      req.signal.addEventListener("abort", () => ac.abort());

      try {
        const safeMode =
          typeof permissionMode === "string" &&
          (VALID_MODES as string[]).includes(permissionMode)
            ? (permissionMode as PermissionMode)
            : undefined;
        await runChatTurn({
          sessionId,
          cwd: canonicalCwd(cwd),
          prompt,
          source: source ?? "text",
          permissionMode: safeMode,
          signal: ac.signal,
          onEvent: send,
        });
      } catch (err) {
        send({ type: "error", message: String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
