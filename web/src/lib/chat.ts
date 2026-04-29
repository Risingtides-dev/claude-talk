import { query } from "@anthropic-ai/claude-agent-sdk";

const VOICE_SYSTEM_NOTE = `The user's most recent message was spoken into a microphone and the response will be read aloud by text-to-speech. Reply in plain prose suitable for TTS: no headings, no bullet lists, no code blocks, no markdown. Lead with a 1–2 sentence direct answer; stop and wait. If the user says "go on" or asks for details, continue. Do not narrate tool calls.

Open every reply with a short conversational lead-in — "Yeah, so…", "Okay,", "Hmm,", "Right,", "Good question —", "Honestly,", or similar — so the first words can start playing instantly while the rest streams. Vary the openers; never use "Certainly" or "Of course" or "I'd be happy to". No sign-off rituals, no "Let me know if there's anything else." Talk like a friend who happens to know the answer.`;

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

  // Tag every Claude Talk prompt so the global CLAUDE.md routing rules
  // know to switch to concise voice-friendly mode for this turn. Desktop
  // sessions that resume the same chat won't have this tag on their own
  // turns, so they behave normally.
  const taggedPrompt = `[ct] ${args.prompt}`;

  const iter = query({
    prompt: taggedPrompt,
    options: {
      cwd: args.cwd,
      resume: args.sessionId,
      abortController: ac,
      permissionMode: args.permissionMode ?? "bypassPermissions",
      // Stream raw token deltas via stream_event messages so the UI can
      // render text as it's produced, instead of waiting for the entire
      // assistant message to finish.
      includePartialMessages: true,
      ...(args.source === "voice"
        ? { appendSystemPrompt: VOICE_SYSTEM_NOTE }
        : {}),
    },
  });

  let resolvedSessionId = args.sessionId ?? "";
  // Track the index of text blocks we've already streamed so we don't
  // re-emit them when the final assistant message arrives.
  const streamedTextBlockIndices = new Set<number>();

  try {
    for await (const message of iter) {
      if (args.signal?.aborted) break;

      if (message.type === "system" && message.subtype === "init") {
        resolvedSessionId = message.session_id ?? resolvedSessionId;
        args.onEvent({ type: "init", sessionId: resolvedSessionId });
        continue;
      }

      // Token-by-token streaming text deltas.
      if (message.type === "stream_event") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ev: any = message.event;
        if (ev?.type === "content_block_delta") {
          const delta = ev.delta;
          if (delta?.type === "text_delta" && typeof delta.text === "string") {
            args.onEvent({ type: "text", delta: delta.text });
            if (typeof ev.index === "number") {
              streamedTextBlockIndices.add(ev.index);
            }
          }
        }
        continue;
      }

      if (message.type === "assistant") {
        const content = message.message?.content;
        if (Array.isArray(content)) {
          content.forEach((block, idx) => {
            if (block.type === "text" && block.text) {
              // Skip text blocks we've already streamed via stream_event.
              if (streamedTextBlockIndices.has(idx)) return;
              args.onEvent({ type: "text", delta: block.text });
            } else if (block.type === "tool_use") {
              args.onEvent({
                type: "tool",
                name: block.name,
                summary: summarizeToolUse(block.name, block.input),
              });
            }
          });
          // Reset for the next assistant message in this turn (e.g. after
          // a tool result, the agent produces a fresh assistant message
          // with its own block indices).
          streamedTextBlockIndices.clear();
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
