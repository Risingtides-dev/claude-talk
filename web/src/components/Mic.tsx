"use client";

import { useEffect, useRef, useState } from "react";

type MicState = "idle" | "recording" | "transcribing" | "speaking";

type Phase =
  | { kind: "idle" }
  | { kind: "starting"; cancelRequested: boolean }
  | { kind: "recording"; mr: MediaRecorder; stream: MediaStream }
  | { kind: "stopping" };

export function Mic({
  state,
  onState,
  onTranscript,
  onInterrupt,
  onPress,
  hotkey = "Space",
}: {
  state: MicState;
  onState: (s: MicState) => void;
  onTranscript: (text: string, ms: number) => void;
  onInterrupt: () => void;
  onPress?: () => void;
  hotkey?: string;
}) {
  const phaseRef = useRef<Phase>({ kind: "idle" });
  const heldRef = useRef(false);
  const [permError, setPermError] = useState<string | null>(null);
  const [slowHint, setSlowHint] = useState(false);
  const [lastHeard, setLastHeard] = useState<string | null>(null);

  const log = (...args: unknown[]) => {
    // eslint-disable-next-line no-console
    console.log("[mic]", ...args);
  };

  const stopStream = (stream: MediaStream | null) => {
    if (!stream) return;
    stream.getTracks().forEach((t) => t.stop());
  };

  async function start() {
    log("start() requested, current phase:", phaseRef.current.kind);
    if (phaseRef.current.kind !== "idle") return;
    // Fire onPress synchronously while we're still inside the user-gesture
    // handler — needed so Speaker.unlock() runs before the mic permission
    // prompt eats the gesture.
    try {
      onPress?.();
    } catch {
      /* ignore */
    }
    if (state === "speaking") onInterrupt();
    setPermError(null);
    setLastHeard(null);

    phaseRef.current = { kind: "starting", cancelRequested: false };

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      setPermError(msg);
      log("getUserMedia failed:", msg);
      phaseRef.current = { kind: "idle" };
      onState("idle");
      return;
    }

    // If the user released the mic before getUserMedia resolved, abort cleanly.
    if (
      phaseRef.current.kind === "starting" &&
      phaseRef.current.cancelRequested
    ) {
      log("cancel before recorder spun up");
      stopStream(stream);
      phaseRef.current = { kind: "idle" };
      onState("idle");
      return;
    }

    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : "";
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];

    mr.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    mr.onstop = async () => {
      log("recorder stopped, chunk count:", chunks.length);
      stopStream(stream);
      const blob = new Blob(chunks, { type: mr.mimeType || "audio/webm" });
      log("blob size:", blob.size, "type:", blob.type);
      if (blob.size < 800) {
        log("blob too small, treating as tap");
        phaseRef.current = { kind: "idle" };
        onState("idle");
        return;
      }
      onState("transcribing");
      const slowTimer = setTimeout(() => setSlowHint(true), 8000);
      try {
        const fd = new FormData();
        const ext = (mr.mimeType.split("/")[1] ?? "webm").split(";")[0];
        fd.append("audio", blob, `clip.${ext}`);
        const res = await fetch("/api/stt", { method: "POST", body: fd });
        const j = await res.json();
        const text = (j?.text ?? "").trim();
        log("STT response:", j);
        setLastHeard(text || "(empty)");
        if (text.length === 0) {
          phaseRef.current = { kind: "idle" };
          onState("idle");
        } else {
          phaseRef.current = { kind: "idle" };
          onTranscript(text, j.ms ?? 0);
        }
      } catch (err) {
        log("STT fetch failed:", err);
        setLastHeard("(error)");
        phaseRef.current = { kind: "idle" };
        onState("idle");
      } finally {
        clearTimeout(slowTimer);
        setSlowHint(false);
      }
    };

    mr.start();
    phaseRef.current = { kind: "recording", mr, stream };
    onState("recording");
    log("recording started");
  }

  function stop() {
    log("stop() requested, current phase:", phaseRef.current.kind);
    const p = phaseRef.current;
    if (p.kind === "starting") {
      // getUserMedia hasn't resolved yet — flag to abort
      p.cancelRequested = true;
      return;
    }
    if (p.kind !== "recording") return;
    phaseRef.current = { kind: "stopping" };
    if (p.mr.state === "recording") p.mr.stop();
  }

  // Hotkey: hold to talk
  useEffect(() => {
    const isTextTarget = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== hotkey) return;
      if (!e.altKey) return;
      if (isTextTarget(e.target)) return;
      e.preventDefault();
      if (heldRef.current) return;
      heldRef.current = true;
      void start();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== hotkey) return;
      if (!heldRef.current) return;
      heldRef.current = false;
      stop();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotkey]);

  useEffect(() => {
    return () => {
      const p = phaseRef.current;
      if (p.kind === "recording") {
        try {
          p.mr.stop();
        } catch {
          /* ignore */
        }
        stopStream(p.stream);
      }
    };
  }, []);

  const label =
    state === "recording"
      ? "Listening…"
      : state === "transcribing"
        ? slowHint
          ? "Warming up Whisper (one-time, ~2 min)…"
          : "Transcribing…"
        : state === "speaking"
          ? "Speaking — tap to interrupt"
          : "Hold ⌥Space or click and hold to talk";

  return (
    <div className="mic-row">
      <button
        type="button"
        className={`mic ${state}`}
        aria-label={label}
        onPointerDown={(e) => {
          e.preventDefault();
          void start();
        }}
        onPointerUp={(e) => {
          e.preventDefault();
          stop();
        }}
        onPointerLeave={() => {
          if (phaseRef.current.kind === "recording") stop();
        }}
        onPointerCancel={() => stop()}
      >
        <span className="dot" />
        <span className="ring" />
      </button>
      <div className="hint">{permError ?? label}</div>
      {lastHeard && (
        <div className="heard" title={lastHeard}>
          <span className="heard-label">heard:</span> {lastHeard}
        </div>
      )}
      <style jsx>{`
        .mic-row {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
        }
        .mic {
          position: relative;
          width: 64px;
          height: 64px;
          border-radius: 50%;
          background: hsl(var(--bg-200));
          border: 1px solid hsl(var(--border-300) / 0.15);
          transition: transform var(--dur-fast) var(--ease),
            background var(--dur-fast) var(--ease),
            border-color var(--dur-fast) var(--ease);
          cursor: pointer;
          user-select: none;
          touch-action: none;
        }
        .mic:hover {
          background: hsl(var(--bg-300));
        }
        .mic .dot {
          position: absolute;
          inset: 0;
          margin: auto;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: hsl(var(--text-300));
          transition: background var(--dur-fast) var(--ease),
            transform var(--dur-fast) var(--ease);
        }
        .mic .ring {
          position: absolute;
          inset: -4px;
          border-radius: 50%;
          border: 2px solid transparent;
          transition: border-color var(--dur-medium) var(--ease);
        }
        .mic.recording {
          background: hsl(var(--clay) / 0.18);
          border-color: hsl(var(--clay) / 0.5);
          transform: scale(1.04);
        }
        .mic.recording .dot {
          background: hsl(var(--clay));
          transform: scale(1.2);
          animation: pulse 1.2s ease-in-out infinite;
        }
        .mic.recording .ring {
          border-color: hsl(var(--clay) / 0.4);
          animation: ringPulse 1.6s ease-out infinite;
        }
        .mic.transcribing .dot {
          background: hsl(var(--accent-100));
          animation: spin 0.9s linear infinite;
          box-shadow: 0 0 0 2px hsl(var(--accent-100) / 0.25);
        }
        .mic.speaking {
          background: hsl(var(--accent-100) / 0.12);
          border-color: hsl(var(--accent-100) / 0.4);
        }
        .mic.speaking .dot {
          background: hsl(var(--accent-100));
          animation: pulse 0.8s ease-in-out infinite;
        }
        .hint {
          font-size: 11px;
          color: hsl(var(--text-400));
          letter-spacing: 0.02em;
          min-height: 14px;
        }
        .heard {
          font-size: 11px;
          color: hsl(var(--text-300));
          max-width: 520px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .heard-label {
          color: hsl(var(--text-400));
          font-family: var(--font-mono);
          font-size: 10px;
          margin-right: 4px;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.55; }
        }
        @keyframes ringPulse {
          0% { transform: scale(0.95); opacity: 0.9; }
          100% { transform: scale(1.5); opacity: 0; }
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
