import { query } from "@anthropic-ai/claude-agent-sdk";

const VOICE_SYSTEM_NOTE = `The user's most recent message was spoken into a microphone and the response will be read aloud by text-to-speech. Reply in plain prose suitable for TTS: no headings, no bullet lists, no code blocks, no markdown. Lead with a 1–2 sentence direct answer; stop and wait. If the user says "go on" or asks for details, continue. Do not narrate tool calls.`;

export type ChatEvent =
  | { type: "init"; sessionId: string }
  | { type: "text"; delta: string }
  | { type: "tool"; name: string; summary: string }
  | { type: "result"; summary: "success" | "error"; sessionId: string }
  | { type: "error"; message: string };

export type ChatTurnArgs = {
  sessionId?: string;
  cwd: string;
  prompt: string;
  source: "text" | "voice";
  permissionMode?:
    | "default"
    | "acceptEdits"
    | "bypassPermissions"
    | "plan"
    | "dontAsk"
    | "auto";
  signal?: AbortSignal;
  onEvent: (e: ChatEvent) => void;
};

function summarizeToolUse(name: string, input: unknown): string {
  if (!input || typeof input !== "object") return name;
  const inp = input as Record<string, unknown>;
  if (typeof inp.file_path === "string") return `${name} ${inp.file_path}`;
  if (typeof inp.command === "string") {
    const cmd = inp.command.split("\n")[0];
    return `${name} ${cmd.length > 60 ? cmd.slice(0, 57) + "…" : cmd}`;
  }
  if (typeof inp.pattern === "string") return `${name} "${inp.pattern}"`;
  if (typeof inp.url === "string") return `${name} ${inp.url}`;
  return name;
}

export async function runChatTurn(args: ChatTurnArgs): Promise<void> {
  const ac = new AbortController();
  if (args.signal) {
    if (args.signal.aborted) ac.abort();
    else args.signal.addEventListener("abort", () => ac.abort());
  }

  const iter = query({
    prompt: args.prompt,
    options: {
      cwd: args.cwd,
      resume: args.sessionId,
      abortController: ac,
      permissionMode: args.permissionMode ?? "bypassPermissions",
      ...(args.source === "voice"
        ? { appendSystemPrompt: VOICE_SYSTEM_NOTE }
        : {}),
    },
  });

  let resolvedSessionId = args.sessionId ?? "";

  try {
    for await (const message of iter) {
      if (args.signal?.aborted) break;
      if (message.type === "system" && message.subtype === "init") {
        resolvedSessionId = message.session_id ?? resolvedSessionId;
        args.onEvent({ type: "init", sessionId: resolvedSessionId });
        continue;
      }

      if (message.type === "assistant") {
        const content = message.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text" && block.text) {
              args.onEvent({ type: "text", delta: block.text });
            } else if (block.type === "tool_use") {
              args.onEvent({
                type: "tool",
                name: block.name,
                summary: summarizeToolUse(block.name, block.input),
              });
            }
          }
        }
        continue;
      }

      if (message.type === "result") {
        args.onEvent({
          type: "result",
          summary: message.subtype === "success" ? "success" : "error",
          sessionId: resolvedSessionId,
        });
      }
    }
  } catch (err) {
    args.onEvent({ type: "error", message: String(err) });
  }
}
