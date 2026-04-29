// Browser-side speaker. Sentence-buffered streaming; per-sentence wav fetched
// from /api/tts, queued and played via Web Audio. playbackRate is used for the
// 0.5–3x speed slider. Handles interrupt cleanly.

export type SpeakerPrefs = {
  voice?: string; // basename in voices/, e.g. "john"
  rate?: number; // 0.5–3, default 1
};

type Job = {
  text: string;
  gen: number;
  buffer: AudioBuffer | null;
  ready: Promise<AudioBuffer | null>;
};

export class Speaker {
  private buffer = "";
  private active = false;
  private prefs: SpeakerPrefs;
  private ctx: AudioContext | null = null;
  private current: { source: AudioBufferSourceNode; ended: Promise<void> } | null = null;
  private queue: Job[] = [];
  private aborted = false;
  private gen = 0;

  constructor(prefs: SpeakerPrefs = {}) {
    this.prefs = { rate: 1, ...prefs };
  }

  setPrefs(prefs: SpeakerPrefs) {
    this.prefs = { ...this.prefs, ...prefs };
    // Live-update playback rate of currently playing source
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
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  /**
   * Must be called from inside a user-gesture handler (e.g. pointerdown on
   * the mic button) to unlock playback on iOS Safari. Plays a silent buffer
   * to fully wake the AudioContext.
   */
  unlock() {
    try {
      const ctx = this.ensureCtx();
      const buf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
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
    try {
      this.ensureCtx();
    } catch {
      /* will throw later if used */
    }
  }

  push(delta: string) {
    // Buffer-only: never enqueue per-sentence. Whole response speaks in end().
    if (!this.active) return;
    this.buffer += delta;
  }

  end() {
    if (!this.active) return;
    const whole = this.buffer.trim();
    this.buffer = "";
    this.active = false;
    if (whole.length > 0) this.enqueue(whole);
  }

  cancel() {
    this.aborted = true;
    this.queue = [];
    this.buffer = "";
    this.active = false;
    if (this.current) {
      try {
        this.current.source.stop();
      } catch {
        /* ignore */
      }
      this.current = null;
    }
  }

  private flushSentences(includeRemainder: boolean) {
    const re = /([^.!?\n]+[.!?]+(?=\s|$)|[^.!?\n]+\n)/g;
    let m: RegExpExecArray | null;
    let lastIndex = 0;
    while ((m = re.exec(this.buffer)) !== null) {
      const piece = m[0].trim();
      if (piece) this.enqueue(piece);
      lastIndex = re.lastIndex;
    }
    if (lastIndex > 0) this.buffer = this.buffer.slice(lastIndex);
    if (includeRemainder && this.buffer.trim().length > 0) {
      this.enqueue(this.buffer.trim());
      this.buffer = "";
    }
  }

  private enqueue(sentence: string) {
    const job: Job = {
      text: sentence,
      gen: this.gen,
      buffer: null,
      ready: this.fetchAndDecode(sentence),
    };
    this.queue.push(job);
    void this.tick();
  }

  private async fetchAndDecode(text: string): Promise<AudioBuffer | null> {
    try {
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
      // decodeAudioData mutates the buffer; clone it for safety in some browsers
      return await ctx.decodeAudioData(ab.slice(0));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[speaker] fetch/decode failed", err);
      return null;
    }
  }

  private running = false;

  private async tick() {
    // Single-runner lock: only one tick loop ever active. Prevents the bug
    // where parallel ticks each grabbed a job and started overlapping sources.
    if (this.running) return;
    this.running = true;
    try {
      while (true) {
        if (this.aborted) return;
        const next = this.queue.shift();
        if (!next) return;
        // Skip stale jobs from a previous begin() generation
        if (next.gen !== this.gen) continue;

        const buf = await next.ready;
        if (this.aborted) return;
        if (next.gen !== this.gen) continue;
        if (!buf) continue;

        const ctx = this.ensureCtx();
        const source = ctx.createBufferSource();
        source.buffer = buf;
        source.playbackRate.value = this.prefs.rate ?? 1;
        source.connect(ctx.destination);

        const ended = new Promise<void>((resolve) => {
          source.onended = () => resolve();
        });
        this.current = { source, ended };
        try {
          source.start();
        } catch {
          this.current = null;
          continue;
        }
        await ended;
        if (this.current?.source === source) this.current = null;
        if (this.aborted) return;
        // Tiny gap to let the previous sentence's audio fully drain before
        // the next source.start(). Without this you can hear the next
        // sentence begin a hair early and overlap the tail of the last one.
        await new Promise<void>((r) => setTimeout(r, 80));
        if (this.aborted) return;
      }
    } finally {
      this.running = false;
    }
  }
}
