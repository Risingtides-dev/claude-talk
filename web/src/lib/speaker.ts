// Browser-side speaker. Buffered text streaming + transport controls
// (pause / resume / scrub / 10s skip / stop / replay last). Plays one
// AudioBufferSource at a time. AudioContext.suspend() is the pause
// mechanism so we can resume without re-decoding.

export type SpeakerPrefs = {
  voice?: string; // basename in voices/
  rate?: number;  // 0.5–3, default 1
  onIdle?: () => void;
  onTransport?: (s: TransportState) => void;
};

export type TransportState = {
  status: "idle" | "loading" | "playing" | "paused";
  duration: number;     // seconds, 0 if unknown
  position: number;     // seconds, current playhead within active wav
  hasAudio: boolean;    // true once a buffer has been decoded for the active turn
};

/** Karaoke snapshot: which text is currently playing and how far into it we are. */
export type KaraokeState = {
  text: string;             // full text of the currently-playing WAV ("" if none)
  charProgress: number;     // 0..1 fraction of text elapsed by playhead
};

type Job = {
  text: string;
  gen: number;
  ready: Promise<AudioBuffer | null>;
};

export class Speaker {
  private buffer = "";
  private active = false;
  private prefs: SpeakerPrefs;
  private ctx: AudioContext | null = null;
  private current:
    | {
        source: AudioBufferSourceNode;
        buffer: AudioBuffer;
        ended: Promise<void>;
        startedAt: number; // ctx.currentTime when source.start was called
        offset: number;    // start offset in seconds passed to source.start
        completed: boolean;
        text: string;      // sentence text powering this WAV (for karaoke)
      }
    | null = null;
  private queue: Job[] = [];
  private aborted = false;
  private gen = 0;
  private running = false;
  private lastTurnText = "";

  // Transport state pushed to UI via prefs.onTransport
  private status: TransportState["status"] = "idle";

  constructor(prefs: SpeakerPrefs = {}) {
    this.prefs = { rate: 1, ...prefs };
  }

  setPrefs(prefs: SpeakerPrefs) {
    this.prefs = { ...this.prefs, ...prefs };
    if (this.current?.source && typeof this.prefs.rate === "number") {
      try {
        this.current.source.playbackRate.value = this.prefs.rate;
      } catch {
        /* ignore */
      }
    }
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      const Ctor =
        (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) throw new Error("AudioContext not supported");
      this.ctx = new Ctor();
    }
    return this.ctx;
  }

  /** iOS unlock: call from a user-gesture handler. */
  unlock() {
    try {
      const ctx = this.ensureCtx();
      const buf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
      if (ctx.state === "suspended") void ctx.resume();
    } catch {
      /* ignore */
    }
  }

  begin() {
    this.cancel();
    this.aborted = false;
    this.buffer = "";
    this.active = true;
    this.gen += 1;
    this.setStatus("loading");
    try {
      this.ensureCtx();
    } catch {
      /* will throw later if used */
    }
  }

  push(delta: string) {
    // Auto-revive after a prior end(): the SDK fires multiple result events
    // per turn, and each may be followed by more text deltas. We want each
    // begin/end cycle to enqueue its own WAV in the play queue, with new
    // pushes after an end implicitly starting the next one.
    if (!this.active) {
      this.active = true;
    }
    this.buffer += delta;
  }

  end() {
    if (!this.active) return;
    const whole = this.buffer.trim();
    this.buffer = "";
    this.active = false;
    if (whole.length > 0) {
      this.lastTurnText = whole;
      // eslint-disable-next-line no-console
      console.log("[speaker] end() — enqueue", whole.length, "chars");
      this.enqueue(whole);
    }
  }

  cancel() {
    this.aborted = true;
    this.queue = [];
    this.buffer = "";
    this.active = false;
    if (this.current) {
      try {
        this.current.source.onended = null;
        this.current.source.stop();
      } catch {
        /* ignore */
      }
      this.current = null;
    }
    if (this.ctx?.state === "suspended") void this.ctx.resume();
    this.setStatus("idle");
  }

  /* ---------------- Transport API ---------------- */

  async pause() {
    if (!this.ctx || !this.current) return;
    if (this.ctx.state === "running") {
      try {
        await this.ctx.suspend();
      } catch {
        /* ignore */
      }
      this.setStatus("paused");
    }
  }

  async resume() {
    if (!this.ctx || !this.current) return;
    if (this.ctx.state === "suspended") {
      try {
        await this.ctx.resume();
      } catch {
        /* ignore */
      }
      this.setStatus("playing");
    }
  }

  /** Jump to absolute seconds within the current wav. */
  seek(seconds: number) {
    if (!this.current || !this.ctx) return;
    const buf = this.current.buffer;
    const t = Math.max(0, Math.min(seconds, buf.duration - 0.01));
    void this.restartFrom(buf, t);
  }

  /** Skip relative to current position. */
  skip(deltaSeconds: number) {
    if (!this.current) return;
    this.seek(this.position() + deltaSeconds);
  }

  /** Replay the last assistant turn we spoke. */
  replayLast() {
    if (!this.lastTurnText) return;
    this.cancel();
    this.aborted = false;
    this.gen += 1;
    this.setStatus("loading");
    try {
      this.ensureCtx();
    } catch {
      return;
    }
    this.enqueue(this.lastTurnText);
  }

  /** Current playhead in seconds. */
  position(): number {
    if (!this.ctx || !this.current) return 0;
    if (this.current.completed) return this.current.buffer.duration;
    const elapsed =
      (this.ctx.currentTime - this.current.startedAt) *
      (this.prefs.rate ?? 1);
    const pos = this.current.offset + elapsed;
    return Math.max(0, Math.min(pos, this.current.buffer.duration));
  }

  duration(): number {
    return this.current?.buffer.duration ?? 0;
  }

  state(): TransportState {
    return {
      status: this.status,
      duration: this.duration(),
      position: this.position(),
      hasAudio: !!this.current,
    };
  }

  /**
   * Snapshot of karaoke progress: which sentence is playing and how far into
   * its text the playhead has elapsed (0..1 by character count). Bubbles use
   * this to highlight the active word.
   */
  karaoke(): KaraokeState {
    if (!this.current) return { text: "", charProgress: 0 };
    const dur = this.current.buffer.duration;
    const pos = this.position();
    const frac = dur > 0 ? Math.max(0, Math.min(1, pos / dur)) : 0;
    return { text: this.current.text, charProgress: frac };
  }

  /* ---------------- Internals ---------------- */

  private async restartFrom(buf: AudioBuffer, offset: number, text?: string) {
    if (!this.ctx) return;
    // Always nudge the AudioContext awake before scheduling a source. iOS
    // can suspend the context after backgrounding the PWA, audio interruptions,
    // or simply on its own; without a resume here `source.start()` succeeds
    // silently and you hear nothing.
    if (this.ctx.state !== "running") {
      try {
        await this.ctx.resume();
      } catch {
        /* ignore — we'll still try to start the source */
      }
    }
    // Carry over existing text if we're restarting the same WAV (seek/skip)
    const carriedText = text ?? this.current?.text ?? "";
    // Stop any existing source, ignore its onended.
    if (this.current) {
      try {
        this.current.source.onended = null;
        this.current.source.stop();
      } catch {
        /* ignore */
      }
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    const source = this.ctx.createBufferSource();
    source.buffer = buf;
    source.playbackRate.value = this.prefs.rate ?? 1;
    source.connect(this.ctx.destination);

    let resolveEnded!: () => void;
    const ended = new Promise<void>((r) => {
      resolveEnded = r;
    });
    source.onended = () => {
      if (this.current && this.current.source === source) {
        this.current.completed = true;
      }
      resolveEnded();
    };

    const startedAt = this.ctx.currentTime;
    try {
      source.start(0, offset);
      // eslint-disable-next-line no-console
      console.log("[speaker] source.start at", offset, "ctx state:", this.ctx.state);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[speaker] source.start failed", err);
    }
    this.current = {
      source,
      buffer: buf,
      ended,
      startedAt,
      offset,
      completed: false,
      text: carriedText,
    };
    this.setStatus("playing");
  }

  private setStatus(s: TransportState["status"]) {
    this.status = s;
    try {
      this.prefs.onTransport?.(this.state());
    } catch {
      /* ignore */
    }
  }

  private enqueue(sentence: string) {
    const job: Job = {
      text: sentence,
      gen: this.gen,
      ready: this.fetchAndDecode(sentence),
    };
    this.queue.push(job);
    void this.tick();
  }

  private async fetchAndDecode(text: string): Promise<AudioBuffer | null> {
    try {
      // eslint-disable-next-line no-console
      console.log("[speaker] fetchAndDecode → /api/tts", { len: text.length, voice: this.prefs.voice ?? "claude" });
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, voice: this.prefs.voice ?? "claude" }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        // eslint-disable-next-line no-console
        console.error("[speaker] /api/tts failed", res.status, j);
        return null;
      }
      const ab = await res.arrayBuffer();
      const ctx = this.ensureCtx();
      // eslint-disable-next-line no-console
      console.log("[speaker] tts → bytes:", ab.byteLength, "ctx state:", ctx.state);
      const buf = await ctx.decodeAudioData(ab.slice(0));
      // eslint-disable-next-line no-console
      console.log("[speaker] decoded:", buf.duration.toFixed(2), "s");
      return buf;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[speaker] fetch/decode failed", err);
      return null;
    }
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      while (true) {
        if (this.aborted) return;
        const next = this.queue.shift();
        if (!next) {
          this.setStatus("idle");
          this.prefs.onIdle?.();
          return;
        }
        if (next.gen !== this.gen) continue;

        const buf = await next.ready;
        if (this.aborted) return;
        if (next.gen !== this.gen) continue;
        if (!buf) continue;

        await this.restartFrom(buf, 0, next.text);
        const cur = this.current!;
        await cur.ended;
        if (this.current?.source === cur.source) {
          // Keep current pinned at the end so transport shows full duration
          // until cancel() or a new turn arrives. UI can call replayLast or seek.
        }
        if (this.aborted) return;
      }
    } finally {
      this.running = false;
    }
  }
}
