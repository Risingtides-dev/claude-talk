"use client";

import { useEffect, useRef, useState } from "react";
import type { TransportState } from "@/lib/speaker";

type MicState = "idle" | "recording" | "transcribing" | "speaking";

type Phase =
  | { kind: "idle" }
  | { kind: "starting"; cancelRequested: boolean }
  | { kind: "recording"; mr: MediaRecorder; stream: MediaStream }
  | { kind: "stopping" };

const RING_R = 36; // ring radius (svg coords)
const RING_C = 2 * Math.PI * RING_R; // circumference

export function Mic({
  state,
  onState,
  onTranscript,
  onInterrupt,
  onPress,
  hotkey = "Space",
  // Halo player props (optional). When transport.hasAudio is true the
  // circle becomes the player surface.
  transport,
  onPause,
  onResume,
  onStop,
  onReplay,
  onSkip,
  onSeek,
}: {
  state: MicState;
  onState: (s: MicState) => void;
  onTranscript: (text: string, ms: number) => void;
  onInterrupt: () => void;
  onPress?: () => void;
  hotkey?: string;
  transport?: TransportState;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
  onReplay?: () => void;
  onSkip?: (deltaSeconds: number) => void;
  onSeek?: (seconds: number) => void;
}) {
  const phaseRef = useRef<Phase>({ kind: "idle" });
  const heldRef = useRef(false);
  const cachedStreamRef = useRef<MediaStream | null>(null);
  const [permError, setPermError] = useState<string | null>(null);
  const [slowHint, setSlowHint] = useState(false);
  const [lastHeard, setLastHeard] = useState<string | null>(null);

  // Halo player state
  const halo = !!transport?.hasAudio;
  const isPlaying = transport?.status === "playing";
  const isPaused = transport?.status === "paused";
  const isLoading = transport?.status === "loading";
  const dur = transport?.duration ?? 0;
  const pos = Math.min(transport?.position ?? 0, dur || 0);
  const ringProgress = dur > 0 ? Math.max(0, Math.min(1, pos / dur)) : 0;

  // Seek-on-ring drag
  const draggingRef = useRef(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  // Distinguish tap (pause/resume) from press-and-hold (record)
  const pressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);

  const log = (...args: unknown[]) => {
    // eslint-disable-next-line no-console
    console.log("[mic]", ...args);
  };

  const stopStream = (stream: MediaStream | null) => {
    if (!stream) return;
    stream.getTracks().forEach((t) => t.stop());
  };

  // Reuse the same MediaStream across recordings to avoid re-prompting for
  // mic permission on every press. iOS / Safari treat each fresh getUserMedia
  // call as a new permission moment on Tailscale Funnel origins, even after
  // the user has already granted access. Keeping one live stream alive
  // bypasses that. We disable the audio track between uses so the orange
  // mic indicator doesn't stay lit.
  async function getOrCreateStream(): Promise<MediaStream> {
    const cached = cachedStreamRef.current;
    if (cached && cached.getAudioTracks().some((t) => t.readyState === "live")) {
      cached.getAudioTracks().forEach((t) => (t.enabled = true));
      return cached;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    cachedStreamRef.current = stream;
    return stream;
  }

  function parkStream() {
    const s = cachedStreamRef.current;
    if (!s) return;
    s.getAudioTracks().forEach((t) => (t.enabled = false));
  }

  async function start() {
    log("start() requested, current phase:", phaseRef.current.kind);
    if (phaseRef.current.kind !== "idle") return;
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
      stream = await getOrCreateStream();
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      setPermError(msg);
      log("getUserMedia failed:", msg);
      phaseRef.current = { kind: "idle" };
      onState("idle");
      return;
    }

    if (
      phaseRef.current.kind === "starting" &&
      phaseRef.current.cancelRequested
    ) {
      log("cancel before recorder spun up");
      parkStream();
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
      parkStream();
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
      }
      // Fully release the cached stream when the component unmounts so the
      // mic indicator goes away.
      stopStream(cachedStreamRef.current);
      cachedStreamRef.current = null;
      if (pressTimerRef.current) {
        window.clearTimeout(pressTimerRef.current);
      }
    };
  }, []);

  /* ---------- Halo: ring drag-to-seek ---------- */

  function ringSecondsFromEvent(e: PointerEvent | React.PointerEvent): number | null {
    const el = buttonRef.current;
    if (!el || !dur) return null;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    // Only treat as ring drag if pointer is on/near the ring (outer 35%)
    const r = Math.sqrt(dx * dx + dy * dy);
    const halfW = rect.width / 2;
    if (r < halfW * 0.65) return null;
    // Angle: 0 at top, increasing clockwise, range [0, 2π)
    let theta = Math.atan2(dy, dx) + Math.PI / 2;
    if (theta < 0) theta += 2 * Math.PI;
    const frac = theta / (2 * Math.PI);
    return frac * dur;
  }

  function handlePointerDown(e: React.PointerEvent) {
    e.preventDefault();
    longPressTriggeredRef.current = false;

    if (halo) {
      // Try ring-seek first
      const t = ringSecondsFromEvent(e);
      if (t != null && onSeek) {
        draggingRef.current = true;
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        onSeek(t);
        return;
      }
      // Center tap → schedule pause/resume on release; long-press → record
      pressTimerRef.current = window.setTimeout(() => {
        longPressTriggeredRef.current = true;
        // Long press during playback → interrupt and record
        if (isPlaying || isPaused) onStop?.();
        void start();
      }, 350);
      return;
    }

    // No audio → normal hold-to-talk
    void start();
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!draggingRef.current) return;
    const t = ringSecondsFromEvent(e);
    if (t != null && onSeek) onSeek(t);
  }

  function handlePointerUp(e: React.PointerEvent) {
    e.preventDefault();
    if (draggingRef.current) {
      draggingRef.current = false;
      (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
      return;
    }
    if (halo) {
      if (pressTimerRef.current) {
        window.clearTimeout(pressTimerRef.current);
        pressTimerRef.current = null;
      }
      if (longPressTriggeredRef.current) {
        // Long press already kicked off recording → release stops it
        stop();
        return;
      }
      // Short tap → pause/resume
      if (isPlaying) onPause?.();
      else if (isPaused) onResume?.();
      else if (isLoading) {
        /* wait */
      }
      return;
    }
    stop();
  }

  function handlePointerLeave() {
    if (phaseRef.current.kind === "recording") stop();
    if (pressTimerRef.current) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
    draggingRef.current = false;
  }

  /* ---------- Labels ---------- */

  const haloLabel = halo
    ? isLoading
      ? "Loading…"
      : isPlaying
        ? "Tap to pause · hold to interrupt"
        : isPaused
          ? "Tap to resume · hold to interrupt"
          : "Done — tap mic to record"
    : null;

  const recLabel =
    state === "recording"
      ? "Listening…"
      : state === "transcribing"
        ? slowHint
          ? "Warming up Whisper (one-time, ~2 min)…"
          : "Transcribing…"
        : state === "speaking"
          ? "Speaking — tap to interrupt"
          : "Hold ⌥Space or click and hold to talk";

  const label = haloLabel ?? recLabel;

  /* ---------- Render ---------- */

  // Active visual state (halo overrides).
  const activeClass = halo
    ? isPlaying
      ? "playing"
      : isPaused
        ? "paused"
        : isLoading
          ? "loading"
          : ""
    : state;

  const dashOffset = RING_C * (1 - ringProgress);

  return (
    <div className="mic-row">
      <button
        type="button"
        ref={buttonRef}
        className={`mic ${activeClass}`}
        aria-label={label}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onPointerCancel={handlePointerLeave}
      >
        {halo && (
          <svg className="halo" viewBox="0 0 80 80" aria-hidden="true">
            <circle
              className="halo-track"
              cx="40"
              cy="40"
              r={RING_R}
              fill="none"
            />
            <circle
              className="halo-fill"
              cx="40"
              cy="40"
              r={RING_R}
              fill="none"
              strokeDasharray={RING_C}
              strokeDashoffset={dashOffset}
              transform="rotate(-90 40 40)"
            />
          </svg>
        )}

        {/* Center icon: play/pause when halo, otherwise the regular dot */}
        {halo ? (
          <span className="center-icon" aria-hidden="true">
            {isPlaying ? (
              <svg viewBox="0 0 24 24">
                <rect x="7" y="5" width="3.5" height="14" rx="0.6" />
                <rect x="13.5" y="5" width="3.5" height="14" rx="0.6" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24">
                <path d="M7 5v14l12-7z" />
              </svg>
            )}
          </span>
        ) : (
          <>
            <span className="dot" />
            <span className="ring" />
          </>
        )}
      </button>

      {/* Ghost button row — only when audio is loaded */}
      {halo && (
        <div className="ghost-row" role="group" aria-label="Playback controls">
          <button
            type="button"
            className="ghost-btn"
            aria-label="Back 10 seconds"
            title="Back 10s"
            onClick={() => onSkip?.(-10)}
          >
            <svg viewBox="0 0 24 24">
              <path d="M11 4 4 11l7 7" />
              <path d="M4 11h11a5 5 0 0 1 5 5" />
            </svg>
          </button>
          <button
            type="button"
            className="ghost-btn"
            aria-label="Forward 10 seconds"
            title="Forward 10s"
            onClick={() => onSkip?.(10)}
          >
            <svg viewBox="0 0 24 24">
              <path d="M13 4l7 7-7 7" />
              <path d="M20 11H9a5 5 0 0 0-5 5" />
            </svg>
          </button>
          <button
            type="button"
            className="ghost-btn"
            aria-label="Replay last response"
            title="Replay last"
            onClick={() => onReplay?.()}
          >
            <svg viewBox="0 0 24 24">
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <path d="M3 4v5h5" />
            </svg>
          </button>
          <button
            type="button"
            className="ghost-btn"
            aria-label="Stop playback"
            title="Stop"
            onClick={() => onStop?.()}
          >
            <svg viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
          </button>
        </div>
      )}

      <div className="hint">{permError ?? label}</div>
      {lastHeard && !halo && (
        <div className="heard" title={lastHeard}>
          <span className="heard-label">heard:</span> {lastHeard}
        </div>
      )}

      <style jsx>{`
        .mic-row {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }
        .mic {
          position: relative;
          width: 80px;
          height: 80px;
          border-radius: 50%;
          background: hsl(var(--bg-200));
          border: 1px solid hsl(var(--border-300) / 0.15);
          transition: transform var(--dur-fast) var(--ease),
            background var(--dur-fast) var(--ease),
            border-color var(--dur-fast) var(--ease);
          cursor: pointer;
          user-select: none;
          touch-action: none;
          padding: 0;
        }
        .mic:hover {
          background: hsl(var(--bg-300));
        }
        .halo {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
        }
        .halo-track {
          stroke: hsl(var(--border-300) / 0.18);
          stroke-width: 2;
        }
        .halo-fill {
          stroke: hsl(var(--clay));
          stroke-width: 2.5;
          stroke-linecap: round;
          transition: stroke-dashoffset 100ms linear;
          filter: drop-shadow(0 0 4px hsl(var(--clay) / 0.5));
        }
        .center-icon {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
        }
        .center-icon :global(svg) {
          width: 26px;
          height: 26px;
          fill: hsl(var(--clay));
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
        .mic.playing {
          background: hsl(var(--clay) / 0.10);
          border-color: hsl(var(--clay) / 0.35);
          box-shadow: 0 0 0 6px hsl(var(--clay) / 0.06);
        }
        .mic.paused {
          background: hsl(var(--bg-200));
          border-color: hsl(var(--border-300) / 0.25);
        }
        .mic.loading {
          background: hsl(var(--bg-200));
          border-color: hsl(var(--border-300) / 0.2);
        }
        .mic.loading .center-icon :global(svg) {
          animation: spin 1.2s linear infinite;
          opacity: 0.7;
        }
        .ghost-row {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 4px 6px;
          margin-top: 2px;
          background: hsl(var(--bg-100) / 0.4);
          border-radius: var(--radius-pill, 9999px);
          backdrop-filter: blur(8px);
          opacity: 0.85;
          transition: opacity var(--dur-fast) var(--ease);
          animation: ghostFadeIn 200ms ease-out both;
        }
        .ghost-row:hover {
          opacity: 1;
        }
        .ghost-btn {
          width: 30px;
          height: 30px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          border-radius: 50%;
          background: transparent;
          color: hsl(var(--text-300));
          transition: background var(--dur-fast) var(--ease),
            color var(--dur-fast) var(--ease);
        }
        .ghost-btn:hover {
          background: hsl(var(--bg-300));
          color: hsl(var(--text-100));
        }
        .ghost-btn :global(svg) {
          width: 14px;
          height: 14px;
          stroke: currentColor;
          fill: none;
          stroke-width: 1.6;
          stroke-linecap: round;
          stroke-linejoin: round;
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
        @keyframes ghostFadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 0.85; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
