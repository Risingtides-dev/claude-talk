"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { projectNameFromCwd } from "@/lib/format";
import { Mic } from "./Mic";
import { Speaker, type TransportState } from "@/lib/speaker";
import { FilePicker } from "./FilePicker";

type SessionMeta = {
  sessionId: string;
  cwd?: string;
  summary?: string;
  firstPrompt?: string;
};

type Turn =
  | { kind: "user"; text: string; key: string }
  | { kind: "assistant"; text: string; tools: string[]; streaming?: boolean; key: string };

type RawMessage = {
  type: string;
  message?: {
    role?: string;
    content?: string | Array<{ type: string; text?: string; name?: string; input?: unknown }>;
  };
  uuid?: string;
};

type MicState = "idle" | "recording" | "transcribing" | "speaking";

function summarizeTool(name: string, input: unknown): string {
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

function stripVoicePreamble(s: string): string {
  // Legacy: older sessions have the wrapper baked into the user message.
  // Strip both the original preamble and any leading [Voice mode ...] block.
  return s.replace(/^\[Voice mode[\s\S]*?\]\s*/m, "");
}

function flattenMessages(raw: RawMessage[]): Turn[] {
  const out: Turn[] = [];
  for (const m of raw) {
    if (m.type === "user") {
      const c = m.message?.content;
      const text = typeof c === "string"
        ? c
        : Array.isArray(c)
          ? c.filter((b) => b.type === "text" && b.text).map((b) => b.text!).join("\n")
          : "";
      if (text.trim().length === 0) continue;
      out.push({ kind: "user", text: stripVoicePreamble(text), key: m.uuid ?? `${out.length}` });
      continue;
    }
    if (m.type === "assistant") {
      const c = m.message?.content;
      let text = "";
      const tools: string[] = [];
      if (Array.isArray(c)) {
        for (const block of c) {
          if (block.type === "text" && block.text) text += block.text;
          if (block.type === "tool_use" && block.name) {
            tools.push(summarizeTool(block.name, block.input));
          }
        }
      } else if (typeof c === "string") {
        text = c;
      }
      if (text.length === 0 && tools.length === 0) continue;
      out.push({ kind: "assistant", text, tools, key: m.uuid ?? `${out.length}` });
    }
  }
  return out;
}

export function Conversation({
  session,
  onSessionResolved,
}: {
  session: SessionMeta | null;
  onSessionResolved?: (sessionId: string) => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [streamTools, setStreamTools] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [showInput, setShowInput] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileUploadRef = useRef<HTMLInputElement | null>(null);
  const cameraUploadRef = useRef<HTMLInputElement | null>(null);

  async function handleUpload(file: File) {
    if (!session?.cwd) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("cwd", session.cwd);
      fd.append("file", file);
      const r = await fetch("/api/upload", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) {
        // eslint-disable-next-line no-console
        console.error("[upload] failed", j);
        return;
      }
      setShowInput(true);
      setInput((cur) => {
        const ref = `"${j.path}"`;
        return cur ? `${cur} ${ref}` : ref;
      });
    } finally {
      setUploading(false);
    }
  }
  const [voiceMode, setVoiceMode] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [voiceName, setVoiceName] = useState<string>("claude");
  const [voices, setVoices] = useState<{ name: string }[]>([]);
  const [permMode, setPermMode] = useState<
    "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk" | "auto"
  >("bypassPermissions");
  const [micState, setMicState] = useState<MicState>("idle");

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const speakerRef = useRef<Speaker | null>(null);
  const [transport, setTransport] = useState<TransportState>({
    status: "idle",
    duration: 0,
    position: 0,
    hasAudio: false,
  });
  const [posTick, setPosTick] = useState(0);

  // Persist voice mode + speed + voice + autoArm; load voices list once
  useEffect(() => {
    const v = localStorage.getItem("voiceMode");
    if (v === "0") setVoiceMode(false);
    else if (v === "1") setVoiceMode(true);
    const s = parseFloat(localStorage.getItem("voiceSpeed") ?? "");
    if (Number.isFinite(s) && s >= 0.5 && s <= 3) setSpeed(s);
    const n = localStorage.getItem("voiceName");
    if (n && n !== "john") setVoiceName(n);
    else setVoiceName("claude");
    const pm = localStorage.getItem("permMode");
    if (
      pm === "default" ||
      pm === "acceptEdits" ||
      pm === "bypassPermissions" ||
      pm === "plan" ||
      pm === "dontAsk" ||
      pm === "auto"
    ) {
      setPermMode(pm);
    }
    fetch("/api/voices")
      .then((r) => r.json())
      .then((j) => setVoices(j.voices ?? []))
      .catch(() => setVoices([]));
  }, []);
  useEffect(() => {
    localStorage.setItem("voiceMode", voiceMode ? "1" : "0");
  }, [voiceMode]);
  useEffect(() => {
    localStorage.setItem("voiceSpeed", String(speed));
    speakerRef.current?.setPrefs({ rate: speed });
  }, [speed]);
  useEffect(() => {
    localStorage.setItem("voiceName", voiceName);
    speakerRef.current?.setPrefs({ voice: voiceName });
  }, [voiceName]);
  useEffect(() => {
    localStorage.setItem("permMode", permMode);
  }, [permMode]);

  // Lazy speaker
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!speakerRef.current) {
      speakerRef.current = new Speaker({
        voice: voiceName,
        rate: speed,
        onTransport: (s) => setTransport(s),
      });
    }
    // Drive a 100ms position tick while audio is loaded so the halo ring
    // updates smoothly during playback (and re-renders for seek/pause).
    const id = setInterval(() => {
      const sp = speakerRef.current;
      if (!sp) return;
      const st = sp.state();
      if (st.hasAudio) setPosTick((n) => n + 1);
    }, 100);
    return () => {
      clearInterval(id);
      speakerRef.current?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset on session change
  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    speakerRef.current?.cancel();
    setMicState("idle");
    setTurns([]);
    setStreamText("");
    setStreamTools([]);
    setStreaming(false);
    setInput("");
    stickToBottom.current = true;

    if (!session) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetch(
      `/api/sessions/${encodeURIComponent(session.sessionId)}?cwd=${encodeURIComponent(session.cwd ?? "")}`,
    )
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setTurns(flattenMessages(j.messages ?? []));
        setLoading(false);
      })
      .catch(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [session?.sessionId, session?.cwd]);

  // Live hydration: while a session is open and we're NOT actively streaming
  // a turn ourselves, poll the JSONL every 3s to pick up turns added in
  // Claude Desktop or the CLI.
  useEffect(() => {
    if (!session) return;
    if (streaming) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await fetch(
          `/api/sessions/${encodeURIComponent(session.sessionId)}?cwd=${encodeURIComponent(session.cwd ?? "")}`,
        );
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled) return;
        const fresh = flattenMessages(j.messages ?? []);
        // Only update if turn count actually grew, to avoid re-render churn
        setTurns((prev) => (fresh.length > prev.length ? fresh : prev));
      } catch {
        /* ignore */
      }
    };
    const id = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [session?.sessionId, session?.cwd, streaming]);

  useEffect(() => {
    if (!stickToBottom.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, streamText, streamTools.length]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  function interrupt() {
    abortRef.current?.abort();
    speakerRef.current?.cancel();
    setStreaming(false);
    setMicState("idle");
  }

  async function send(prompt: string, source: "text" | "voice") {
    if (!session || !prompt.trim()) return;
    abortRef.current?.abort();
    speakerRef.current?.cancel();
    const ac = new AbortController();
    abortRef.current = ac;

    setTurns((t) => [
      ...t,
      { kind: "user", text: prompt, key: `local-${Date.now()}` },
    ]);
    setStreamText("");
    setStreamTools([]);
    setStreaming(true);
    stickToBottom.current = true;

    const willSpeak = source === "voice" && voiceMode;
    if (willSpeak) {
      speakerRef.current?.begin();
      setMicState("speaking");
    } else {
      setMicState("idle");
    }

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: session.sessionId,
          cwd: session.cwd,
          prompt,
          source,
          permissionMode: permMode,
        }),
        signal: ac.signal,
      });
      if (!res.body) throw new Error("No stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let acc = "";
      const tools: string[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split("\n\n");
        buf = events.pop() ?? "";
        for (const ev of events) {
          const line = ev.trim();
          if (!line.startsWith("data:")) continue;
          const jsonStr = line.slice(5).trim();
          if (!jsonStr) continue;
          let data: { type: string; [k: string]: unknown };
          try {
            data = JSON.parse(jsonStr);
          } catch {
            continue;
          }
          if (data.type === "init" && data.sessionId) {
            onSessionResolved?.(data.sessionId as string);
          } else if (data.type === "text" && typeof data.delta === "string") {
            acc += data.delta;
            setStreamText(acc);
            if (willSpeak) speakerRef.current?.push(data.delta);
          } else if (data.type === "tool" && typeof data.summary === "string") {
            tools.push(data.summary);
            setStreamTools([...tools]);
          } else if (data.type === "result") {
            setTurns((t) => [
              ...t,
              { kind: "assistant", text: acc, tools: [...tools], key: `r-${Date.now()}` },
            ]);
            setStreamText("");
            setStreamTools([]);
            setStreaming(false);
            if (willSpeak) {
              // Cancel any prior playback first so multi-result turns don't
              // stack overlapping wavs of the same accumulated buffer.
              speakerRef.current?.cancel();
              speakerRef.current?.begin();
              speakerRef.current?.push(acc);
              speakerRef.current?.end();
              setMicState("idle");
            }
          } else if (data.type === "error") {
            setTurns((t) => [
              ...t,
              {
                kind: "assistant",
                text: `[error: ${data.message}]`,
                tools: [],
                key: `e-${Date.now()}`,
              },
            ]);
            setStreaming(false);
            if (willSpeak) {
              speakerRef.current?.cancel();
              setMicState("idle");
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setStreaming(false);
        if (willSpeak) speakerRef.current?.cancel();
        setMicState("idle");
        setTurns((t) => [
          ...t,
          {
            kind: "assistant",
            text: `[network error: ${String(err)}]`,
            tools: [],
            key: `n-${Date.now()}`,
          },
        ]);
      }
    } finally {
      setStreaming(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = input;
    setInput("");
    void send(v, "text");
  }

  function handleTranscript(text: string, _ms: number) {
    setMicState("idle");
    void send(text, voiceMode ? "voice" : "text");
  }

  const titleLine = useMemo(() => {
    if (!session) return "No session selected";
    return session.summary ?? session.firstPrompt ?? session.sessionId.slice(0, 8);
  }, [session]);

  // Live transport state: blends the latched onTransport snapshot with the
  // up-to-the-tick playhead so the halo ring animates smoothly. posTick is in
  // the dep list to force this object to re-create each 100ms tick.
  const liveTransport: TransportState = useMemo(() => {
    const sp = speakerRef.current;
    if (!sp) return transport;
    const live = sp.state();
    return {
      status: live.status,
      duration: live.duration,
      position: live.position,
      hasAudio: live.hasAudio,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transport, posTick]);

  if (!session) {
    return (
      <main className="conv">
        <div className="empty">
          <div className="empty-title">Pick a session from the sidebar</div>
          <div className="empty-sub">
            Or open Claude Desktop, start a new chat, and refresh.
          </div>
        </div>
        <style jsx>{`
          .conv { display: flex; flex: 1; align-items: center; justify-content: center; }
          .empty-title { font-size: 16px; color: hsl(var(--text-300)); }
          .empty-sub { margin-top: 8px; font-size: 13px; color: hsl(var(--text-400)); }
        `}</style>
      </main>
    );
  }

  return (
    <main className="conv">
      <div className="topstrip">
        <div className="project">{projectNameFromCwd(session.cwd)}</div>
        <div className="title">{titleLine}</div>
      </div>

      <div className="scroll" ref={scrollRef} onScroll={handleScroll}>
        {loading && <div className="empty">Loading transcript…</div>}
        {!loading && turns.length === 0 && (
          <div className="empty">No turns yet — say something.</div>
        )}
        {turns.map((t) =>
          t.kind === "user" ? (
            <UserBubble key={t.key} text={t.text} />
          ) : (
            <AssistantBubble key={t.key} text={t.text} tools={t.tools} />
          ),
        )}
        {streaming && (
          <AssistantBubble text={streamText} tools={streamTools} streaming />
        )}
      </div>

      <div className="dock">
        <div className="voice-controls">
          <select
            className="perm-select"
            value={permMode}
            onChange={(e) =>
              setPermMode(e.target.value as typeof permMode)
            }
            aria-label="Permission mode"
            title="Permission mode"
          >
            <option value="default">default</option>
            <option value="acceptEdits">acceptEdits</option>
            <option value="bypassPermissions">bypass</option>
            <option value="plan">plan</option>
            <option value="dontAsk">dontAsk</option>
            <option value="auto">auto</option>
          </select>
          <select
            className="voice-select"
            value={voiceName}
            onChange={(e) => setVoiceName(e.target.value)}
            disabled={!voiceMode || voices.length === 0}
            aria-label="Voice"
            title="Voice"
          >
            {voices.length === 0 && (
              <option value={voiceName}>{voiceName}</option>
            )}
            {voices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name}
              </option>
            ))}
          </select>
          <button
            className={`voice-toggle ${voiceMode ? "on" : ""}`}
            onClick={() => {
              const next = !voiceMode;
              setVoiceMode(next);
              if (!next) speakerRef.current?.cancel();
            }}
            title={voiceMode ? "Voice mode on" : "Voice mode off"}
          >
            <span className="vt-dot" />
            <span>Voice</span>
          </button>
        </div>
        <Mic
          state={micState}
          onState={setMicState}
          onTranscript={handleTranscript}
          onInterrupt={interrupt}
          onPress={() => speakerRef.current?.unlock()}
          transport={liveTransport}
          onPause={() => speakerRef.current?.pause()}
          onResume={() => speakerRef.current?.resume()}
          onStop={() => speakerRef.current?.cancel()}
          onReplay={() => speakerRef.current?.replayLast()}
          onSkip={(d: number) => speakerRef.current?.skip(d)}
          onSeek={(t: number) => speakerRef.current?.seek(t)}
        />
        <div className="speed">
          <label htmlFor="speed-slider" title={`Playback ${speed.toFixed(2)}x`}>
            {speed.toFixed(2)}x
          </label>
          <input
            id="speed-slider"
            type="range"
            min={0.5}
            max={3}
            step={0.05}
            value={speed}
            onChange={(e) => setSpeed(parseFloat(e.target.value))}
            disabled={!voiceMode}
            aria-label="Playback speed"
          />
        </div>
        <div className="dock-actions">
          <button
            className="dock-btn"
            onClick={() => setPickerOpen(true)}
            aria-label="Browse files on this Mac"
            title="Browse Mac files"
          >
            <svg viewBox="0 0 24 24">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
            </svg>
          </button>
          <button
            className="dock-btn"
            onClick={() => fileUploadRef.current?.click()}
            aria-label="Upload a file"
            title="Upload"
            disabled={uploading || !session?.cwd}
          >
            {uploading ? (
              <svg viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="9" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24">
                <path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5" />
                <path d="M16 4l4 4-4 4" />
                <path d="M20 8H10" />
              </svg>
            )}
          </button>
          <button
            className="dock-btn camera-only"
            onClick={() => cameraUploadRef.current?.click()}
            aria-label="Take a photo"
            title="Camera"
            disabled={uploading || !session?.cwd}
          >
            <svg viewBox="0 0 24 24">
              <path d="M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
          </button>
          <button
            className="kbd-toggle"
            onClick={() => setShowInput((v) => !v)}
            aria-label="Toggle keyboard input"
            title="Type instead"
          >
            {showInput ? "Hide keyboard" : "Type"}
          </button>
          <input
            ref={fileUploadRef}
            type="file"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleUpload(f);
              e.target.value = "";
            }}
          />
          <input
            ref={cameraUploadRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleUpload(f);
              e.target.value = "";
            }}
          />
        </div>
        {pickerOpen && (
          <FilePicker
            startDir={session?.cwd}
            onClose={() => setPickerOpen(false)}
            onPick={(p) => {
              setPickerOpen(false);
              setShowInput(true);
              // Append the absolute path into the input as a quoted reference
              // the agent will pick up via Read tool.
              setInput((cur) => {
                const ref = `"${p}"`;
                return cur ? `${cur} ${ref}` : ref;
              });
            }}
          />
        )}
        {showInput && (
          <form className="composer" onSubmit={handleSubmit}>
            <textarea
              ref={(el) => {
                if (!el) return;
                // auto-grow up to a max height
                el.style.height = "auto";
                const max = 220;
                el.style.height = Math.min(el.scrollHeight, max) + "px";
              }}
              className="composer-input"
              placeholder="Type a message…  (Enter to send, Shift+Enter for newline)"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 220) + "px";
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (input.trim() && !streaming) {
                    const v = input;
                    setInput("");
                    void send(v, "text");
                  }
                }
              }}
              rows={2}
              autoFocus
            />
            <button
              type="submit"
              className="send"
              disabled={!input.trim() || streaming}
              aria-label="Send"
            >
              {streaming ? "…" : "Send"}
            </button>
          </form>
        )}
      </div>

      <style jsx>{`
        @media (max-width: 760px) {
          .conv { padding-top: 48px; }
          .topstrip { display: none; }
          .voice-controls { display: none; }
          .speed { display: none; }
          .kbd-toggle {
            font-size: 12px;
            padding: 6px 12px;
            margin-top: 6px;
          }
          .dock {
            padding: 0 0 calc(env(safe-area-inset-bottom, 0) + 18px) 0;
            gap: 4px;
            min-height: 38dvh;
            justify-content: center;
            align-items: center;
          }
          .dock :global(.mic) {
            width: 110px !important;
            height: 110px !important;
          }
          .dock :global(.mic .dot) {
            width: 22px !important;
            height: 22px !important;
          }
          .dock :global(.hint) { font-size: 13px !important; }
          .composer {
            width: 92%;
            max-width: 92%;
            padding: 0 16px;
            margin-top: 6px;
          }
          .composer-input {
            font-size: 16px; /* prevents iOS zoom on focus */
          }
        }
        .conv {
          display: flex;
          flex-direction: column;
          flex: 1;
          background: hsl(var(--bg-000));
          min-width: 0;
        }
        .topstrip {
          display: flex;
          align-items: center;
          gap: 12px;
          height: var(--topstrip-h);
          padding: 0 20px;
          border-bottom: 1px solid hsl(var(--border-300) / 0.1);
          font-size: 13px;
        }
        .project { color: hsl(var(--text-400)); }
        .title {
          color: hsl(var(--text-100));
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .perm-select {
          padding: 4px 8px;
          background: hsl(var(--bg-200));
          border-radius: var(--radius-md);
          font-size: 11px;
          font-family: var(--font-mono);
          color: hsl(var(--text-300));
          appearance: none;
          -webkit-appearance: none;
          cursor: pointer;
          transition: background var(--dur-fast) var(--ease);
        }
        .perm-select:hover {
          background: hsl(var(--bg-300));
        }
        .voice-select {
          padding: 4px 8px;
          background: hsl(var(--bg-200));
          border-radius: var(--radius-md);
          font-size: 12px;
          font-family: var(--font-sans);
          color: hsl(var(--text-200));
          appearance: none;
          -webkit-appearance: none;
          cursor: pointer;
          max-width: 140px;
          transition: background var(--dur-fast) var(--ease);
        }
        .voice-select:hover:not(:disabled) {
          background: hsl(var(--bg-300));
        }
        .voice-select:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .speed {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 11px;
          font-family: var(--font-mono);
          color: hsl(var(--text-400));
        }
        .speed label {
          width: 38px;
          text-align: right;
        }
        .speed input[type="range"] {
          width: 100px;
          accent-color: hsl(var(--clay));
          cursor: pointer;
        }
        .speed input[type="range"]:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .voice-toggle {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          font-size: 12px;
          color: hsl(var(--text-300));
          background: hsl(var(--bg-200));
          border-radius: var(--radius-pill, 9999px);
          transition: all var(--dur-fast) var(--ease);
        }
        .voice-toggle:hover { background: hsl(var(--bg-300)); }
        .voice-toggle .vt-dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: hsl(var(--text-400));
          transition: background var(--dur-fast) var(--ease),
            box-shadow var(--dur-fast) var(--ease);
        }
        .voice-toggle.on { color: hsl(var(--clay)); background: hsl(var(--clay) / 0.12); }
        .voice-toggle.on .vt-dot {
          background: hsl(var(--clay));
          box-shadow: 0 0 0 3px hsl(var(--clay) / 0.2);
        }
        .scroll { flex: 1; overflow-y: auto; padding: 24px 0; }
        .empty {
          padding: 40px 24px;
          color: hsl(var(--text-400));
          text-align: center;
          font-size: 14px;
        }
        .dock {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          padding: 14px 20px 22px;
          border-top: 1px solid hsl(var(--border-300) / 0.1);
        }
        .voice-controls {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 2px;
        }
        .kbd-toggle {
          font-size: 11px;
          color: hsl(var(--text-400));
          padding: 2px 6px;
          border-radius: 4px;
          transition: color var(--dur-fast) var(--ease);
        }
        .kbd-toggle:hover { color: hsl(var(--text-200)); }
        .dock-actions {
          display: flex;
          gap: 8px;
          align-items: center;
          margin-top: 6px;
        }
        .dock-btn {
          width: 36px;
          height: 36px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          border-radius: var(--radius-md);
          background: hsl(var(--bg-200));
          color: hsl(var(--text-300));
          transition: background var(--dur-fast) var(--ease),
            color var(--dur-fast) var(--ease);
        }
        .dock-btn :global(svg) {
          width: 18px;
          height: 18px;
          stroke: currentColor;
          fill: none;
          stroke-width: 1.6;
          stroke-linecap: round;
          stroke-linejoin: round;
        }
        .dock-btn:hover {
          background: hsl(var(--bg-300));
          color: hsl(var(--text-100));
        }
        .dock-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .camera-only { display: none; }
        @media (max-width: 760px) { .camera-only { display: inline-flex; } }
        .composer {
          display: flex;
          align-items: flex-end;
          gap: 8px;
          width: 100%;
          max-width: 760px;
        }
        .composer-input {
          flex: 1;
          padding: 10px 14px;
          background: hsl(var(--bg-100));
          border-radius: var(--radius-lg);
          font-size: 14px;
          line-height: 1.45;
          resize: none;
          min-height: 40px;
          max-height: 220px;
          overflow-y: auto;
          font-family: inherit;
          color: hsl(var(--text-100));
          border: 1px solid hsl(var(--border-300) / 0.12);
        }
        .composer-input:focus {
          outline: none;
          border-color: hsl(var(--clay) / 0.4);
        }
        .send {
          padding: 0 16px;
          background: hsl(var(--clay));
          color: white;
          border-radius: var(--radius-lg);
          font-size: 13px;
          font-weight: 500;
          transition: background var(--dur-fast) var(--ease);
        }
        .send:hover:not(:disabled) { background: hsl(var(--clay-hover)); }
        .send:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
    </main>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="bubble user">
      <div className="text">{text}</div>
      <style jsx>{`
        .bubble {
          padding: 8px 24px;
          max-width: 760px;
          margin: 8px auto;
          width: 100%;
        }
        .text {
          padding: 10px 14px;
          background: hsl(var(--bg-100));
          border-radius: var(--radius-lg);
          font-size: 14px;
          line-height: 1.5;
          color: hsl(var(--text-200));
          white-space: pre-wrap;
        }
      `}</style>
    </div>
  );
}

function AssistantBubble({
  text,
  tools,
  streaming,
}: {
  text: string;
  tools: string[];
  streaming?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasTools = tools.length > 0;
  return (
    <div className="bubble assistant">
      {hasTools && (
        <button
          className={`tools ${streaming ? "active" : ""}`}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded
            ? `▾ ${tools.length} tool call${tools.length === 1 ? "" : "s"}`
            : streaming
              ? `▸ working…`
              : `▸ ${tools.length} tool call${tools.length === 1 ? "" : "s"}`}
        </button>
      )}
      {expanded && (
        <ul className="tool-list">
          {tools.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      )}
      {text && (
        <div className="text">
          {text}
          {streaming && <span className="caret">▍</span>}
        </div>
      )}
      <style jsx>{`
        .bubble {
          padding: 8px 24px;
          max-width: 760px;
          margin: 8px auto;
          width: 100%;
        }
        .text {
          font-family: var(--font-serif);
          font-size: 16px;
          line-height: 1.6;
          color: hsl(var(--text-100));
          white-space: pre-wrap;
        }
        .caret {
          display: inline-block;
          margin-left: 2px;
          color: hsl(var(--clay));
          animation: blink 1s steps(2) infinite;
        }
        @keyframes blink {
          50% { opacity: 0; }
        }
        .tools {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 3px 10px;
          margin-bottom: 6px;
          font-family: var(--font-mono);
          font-size: 12px;
          color: hsl(var(--text-400));
          background: hsl(var(--bg-200));
          border-radius: var(--radius-pill, 9999px);
          transition: color var(--dur-fast) var(--ease);
        }
        .tools.active { color: hsl(var(--clay)); }
        .tools:hover { color: hsl(var(--text-200)); }
        .tool-list {
          list-style: none;
          padding: 6px 12px;
          margin: 0 0 8px;
          background: hsl(var(--bg-200));
          border-radius: var(--radius-md);
          font-family: var(--font-mono);
          font-size: 12px;
          color: hsl(var(--text-300));
        }
        .tool-list li { padding: 2px 0; }
      `}</style>
    </div>
  );
}
