// HTMLAudioElement-based speaker. Plays a queue of TTS WAV blobs back-to-back.
// Uses <audio> instead of WebAudio because iOS PWA standalone mode plays
// HTMLAudio reliably while WebAudio often stays silent there.

export type SpeakerPrefs = {
  voice?: string;
  rate?: number;
  onIdle?: () => void;
  onTransport?: (s: TransportState) => void;
};

export type TransportState = {
  status: "idle" | "loading" | "playing" | "paused";
  duration: number;
  position: number;
  hasAudio: boolean;
};

export type KaraokeState = {
  text: string;
  charProgress: number;
};

type Job = {
  seq: number;       // monotonically increasing slot number — playback order
  text: string;
  url: string | null;       // object URL for the decoded WAV (null until fetch resolves)
  duration: number;  // seconds
  ready: boolean;    // true once fetch + duration probe are done
  failed: boolean;   // true if the fetch errored — skip during playback
  waiters: Array<() => void>; // resolvers waiting on this slot to become ready
};

// Short conversational acknowledgments played the instant a turn is sent,
// so the user hears something while the LLM + TTS spin up. Real TTS chunks
// preempt the backchannel via cancelBackchannel().
const BACKCHANNEL_PHRASES = [
  "mhm",
  "okay",
  "yeah",
  "hmm",
  "got it",
  "right",
];

export class Speaker {
  private prefs: SpeakerPrefs;
  private audio: HTMLAudioElement | null = null;
  private queue: Job[] = [];
  private current: Job | null = null;
  private running = false;
  private aborted = false;
  private status: TransportState["status"] = "idle";
  private lastTurnText = "";
  private nextSeq = 0; // assigns playback order at enqueue time

  // Backchannel state: separate <audio> element + pre-cached blob URLs so
  // the latency-killer is just an in-memory swap of `src` and a `play()`.
  private backchannelAudio: HTMLAudioElement | null = null;
  private backchannelUrls: string[] = [];
  private backchannelLoading: Promise<void> | null = null;
  private backchannelVoice: string | null = null; // voice key the cache was built against

  constructor(prefs: SpeakerPrefs = {}) {
    this.prefs = { rate: 1, ...prefs };
  }

  setPrefs(prefs: SpeakerPrefs) {
    this.prefs = { ...this.prefs, ...prefs };
    if (this.audio && typeof this.prefs.rate === "number") {
      try {
        this.audio.playbackRate = this.prefs.rate;
      } catch {
        /* ignore */
      }
    }
  }

  /** iOS unlock — call inside a user-gesture handler. */
  unlock() {
    if (!this.audio) this.audio = this.createAudioEl();
    const a = this.audio;
    if (a.dataset.unlocked === "1") return;
    try {
      // Start playing 30s of silence right now so the element is in a
      // "playing" state. We later swap src to real audio without losing the
      // gesture grant. iOS only allows src→play if we're already playing
      // OR still in a gesture. The silence keeps us "playing".
      a.muted = false;
      a.loop = true;
      a.src =
        "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
      const p = a.play();
      if (p && typeof p.then === "function") {
        p.then(() => {
          a.dataset.unlocked = "1";
          a.loop = false;
        }).catch(() => {
          /* user-gesture not granted — best effort */
        });
      } else {
        a.dataset.unlocked = "1";
        a.loop = false;
      }
    } catch {
      /* ignore */
    }
  }

  begin() {
    this.cancel();
    this.aborted = false;
    this.setStatus("loading");
  }

  /**
   * Play a tiny "mhm"-style acknowledgment immediately, while the real
   * response is still generating. Uses a separate <audio> element so it
   * doesn't interfere with the main slot queue. Real TTS chunks preempt it
   * via cancelBackchannel(). Safe to call from inside a user-gesture
   * callstack — that's actually the point.
   */
  async playBackchannel() {
    if (this.aborted) return;
    // If a real chunk is already queued or playing, don't insert filler.
    if (this.queue.length > 0 || this.current) return;
    try {
      await this.ensureBackchannels();
      const url = this.pickBackchannelUrl();
      if (!url) return;
      // Bail late: a real chunk may have arrived while we were warming.
      if (this.queue.length > 0 || this.current || this.aborted) return;
      let bc = this.backchannelAudio;
      if (!bc) {
        bc = new Audio();
        bc.preload = "auto";
        this.backchannelAudio = bc;
      }
      bc.src = url;
      bc.currentTime = 0;
      bc.volume = 0.85;
      bc.playbackRate = this.prefs.rate ?? 1;
      void bc.play().catch(() => {
        /* gesture lost or audio still locked — best effort */
      });
    } catch {
      /* never block the real response */
    }
  }

  /** Stop any backchannel that's currently playing. Idempotent. */
  cancelBackchannel() {
    const bc = this.backchannelAudio;
    if (!bc) return;
    try {
      if (!bc.paused) bc.pause();
      bc.currentTime = 0;
    } catch {
      /* ignore */
    }
  }

  private pickBackchannelUrl(): string | null {
    if (this.backchannelUrls.length === 0) return null;
    const idx = Math.floor(Math.random() * this.backchannelUrls.length);
    return this.backchannelUrls[idx] ?? null;
  }

  private async ensureBackchannels(): Promise<void> {
    const voice = this.prefs.voice ?? "claude";
    if (
      this.backchannelUrls.length > 0 &&
      this.backchannelVoice === voice
    ) {
      return;
    }
    if (this.backchannelLoading) return this.backchannelLoading;
    this.backchannelLoading = (async () => {
      // Free any prior-voice cache.
      for (const u of this.backchannelUrls) {
        try {
          URL.revokeObjectURL(u);
        } catch {
          /* ignore */
        }
      }
      this.backchannelUrls = [];
      const fresh: string[] = [];
      // Render in parallel; ignore failures so even a partial cache works.
      await Promise.all(
        BACKCHANNEL_PHRASES.map(async (phrase) => {
          try {
            const res = await fetch("/api/tts", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ text: phrase, voice }),
            });
            if (!res.ok) return;
            const ab = await res.arrayBuffer();
            const blob = new Blob([new Uint8Array(ab)], { type: "audio/wav" });
            fresh.push(URL.createObjectURL(blob));
          } catch {
            /* ignore */
          }
        }),
      );
      this.backchannelUrls = fresh;
      this.backchannelVoice = voice;
    })();
    try {
      await this.backchannelLoading;
    } finally {
      this.backchannelLoading = null;
    }
  }

  /** Append a chunk and play it back when its turn comes up in the queue. */
  enqueueChunk(text: string) {
    const t = text.trim();
    if (!t) return;
    this.aborted = false;
    this.lastTurnText = (this.lastTurnText + " " + t).trim();
    if (this.status === "idle") this.setStatus("loading");
    // Reserve this slot's order RIGHT NOW so playback respects the order
    // chunks were enqueued in, not the order their TTS fetches finish.
    const job: Job = {
      seq: this.nextSeq++,
      text: t,
      url: null,
      duration: 0,
      ready: false,
      failed: false,
      waiters: [],
    };
    this.queue.push(job);
    void this.fetchAndQueue(job);
    // Kick the playback loop in case it was idle.
    void this.tick();
  }

  // Compatibility shims so existing callers (begin/push/end) still work.
  private buffer = "";
  push(delta: string) {
    this.buffer += delta;
  }
  end() {
    const whole = this.buffer.trim();
    this.buffer = "";
    if (whole.length > 0) this.enqueueChunk(whole);
  }

  cancel() {
    this.aborted = true;
    this.cancelBackchannel();
    // Free anything we already fetched, and unblock any pending waiters so
    // their fetch handlers can exit cleanly.
    for (const j of this.queue) {
      if (j.url) {
        try {
          URL.revokeObjectURL(j.url);
        } catch {
          /* ignore */
        }
      }
      const w = j.waiters;
      j.waiters = [];
      for (const r of w) r();
    }
    this.queue = [];
    this.current = null;
    this.buffer = "";
    if (this.audio) {
      try {
        this.audio.pause();
        this.audio.currentTime = 0;
      } catch {
        /* ignore */
      }
    }
    this.setStatus("idle");
  }

  pause() {
    if (!this.audio) return;
    try {
      this.audio.pause();
    } catch {
      /* ignore */
    }
    this.setStatus("paused");
  }

  resume() {
    if (!this.audio || !this.current) return;
    try {
      void this.audio.play();
    } catch {
      /* ignore */
    }
    this.setStatus("playing");
  }

  seek(seconds: number) {
    if (!this.audio || !this.current) return;
    try {
      this.audio.currentTime = Math.max(
        0,
        Math.min(seconds, this.current.duration - 0.01),
      );
    } catch {
      /* ignore */
    }
  }

  skip(deltaSeconds: number) {
    this.seek(this.position() + deltaSeconds);
  }

  replayLast() {
    if (!this.lastTurnText) return;
    const text = this.lastTurnText;
    this.cancel();
    this.aborted = false;
    this.setStatus("loading");
    // Re-enqueue as a single chunk so it goes through the ordered slot path.
    this.enqueueChunk(text);
  }

  position(): number {
    return this.audio?.currentTime ?? 0;
  }
  duration(): number {
    return this.current?.duration ?? this.audio?.duration ?? 0;
  }
  state(): TransportState {
    return {
      status: this.status,
      duration: this.duration(),
      position: this.position(),
      hasAudio: !!this.current,
    };
  }
  karaoke(): KaraokeState {
    if (!this.current) return { text: "", charProgress: 0 };
    const dur = this.current.duration;
    const pos = this.position();
    const frac = dur > 0 ? Math.max(0, Math.min(1, pos / dur)) : 0;
    return { text: this.current.text, charProgress: frac };
  }

  /* ------------ internals ------------ */

  private createAudioEl(): HTMLAudioElement {
    const a = new Audio();
    a.preload = "auto";
    a.playbackRate = this.prefs.rate ?? 1;
    a.addEventListener("timeupdate", () => {
      // status updates are pushed via setStatus; timeupdate just keeps the
      // transport.position fresh on parent reads.
      if (this.audio === a) this.prefs.onTransport?.(this.state());
    });
    a.addEventListener("ended", () => {
      // current track finished; advance.
    });
    return a;
  }

  /**
   * Fetch TTS for an already-reserved slot and mark it ready. Slots are
   * created in enqueueChunk() with a fixed seq number, so playback order is
   * locked in regardless of which fetch finishes first.
   */
  private async fetchAndQueue(job: Job) {
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: job.text,
          voice: this.prefs.voice ?? "claude",
        }),
      });
      if (!res.ok) {
        this.markJobFailed(job);
        return;
      }
      const ab = await res.arrayBuffer();
      const blob = new Blob([new Uint8Array(ab)], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);
      const dur = await this.probeDuration(url);
      // If the speaker was canceled while we were fetching, drop this audio.
      if (this.aborted || !this.queue.includes(job)) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* ignore */
        }
        return;
      }
      job.url = url;
      job.duration = dur;
      job.ready = true;
      this.flushWaiters(job);
      void this.tick();
    } catch {
      this.markJobFailed(job);
    }
  }

  private markJobFailed(job: Job) {
    job.failed = true;
    job.ready = true; // ready in the sense that tick() can move past it
    this.flushWaiters(job);
    void this.tick();
  }

  private flushWaiters(job: Job) {
    const w = job.waiters;
    job.waiters = [];
    for (const r of w) r();
  }

  private waitForJob(job: Job): Promise<void> {
    if (job.ready) return Promise.resolve();
    return new Promise<void>((resolve) => {
      job.waiters.push(resolve);
    });
  }

  private probeDuration(url: string): Promise<number> {
    return new Promise((resolve) => {
      const probe = new Audio();
      probe.preload = "metadata";
      probe.src = url;
      const finish = (d: number) => {
        try {
          probe.src = "";
        } catch {
          /* ignore */
        }
        resolve(Number.isFinite(d) ? d : 0);
      };
      probe.addEventListener("loadedmetadata", () => finish(probe.duration));
      probe.addEventListener("error", () => finish(0));
      // safety timeout
      setTimeout(() => finish(probe.duration || 0), 2000);
    });
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      while (true) {
        if (this.aborted) return;
        const next = this.queue[0];
        if (!next) {
          this.current = null;
          this.setStatus("idle");
          this.prefs.onIdle?.();
          return;
        }
        // Slot is reserved but TTS hasn't returned yet — wait, don't skip.
        // This is what fixes the out-of-order playback bug: a faster later
        // chunk can't jump ahead because we always wait on this one first.
        if (!next.ready) {
          if (this.status !== "loading") this.setStatus("loading");
          await this.waitForJob(next);
          if (this.aborted) return;
          continue;
        }
        // Pop only after it's playable.
        this.queue.shift();
        if (next.failed || !next.url) {
          continue;
        }
        if (!this.audio) this.audio = this.createAudioEl();
        // First real chunk is about to play — silence any backchannel that
        // was bridging the gap so they don't double up.
        this.cancelBackchannel();
        this.current = next;
        this.audio.src = next.url;
        this.audio.playbackRate = this.prefs.rate ?? 1;
        this.setStatus("playing");
        try {
          await this.audio.play();
        } catch {
          // play() can reject if context wasn't unlocked — bail this chunk.
          try {
            if (next.url) URL.revokeObjectURL(next.url);
          } catch {
            /* ignore */
          }
          continue;
        }
        // Wait for playback to end (or be canceled).
        await new Promise<void>((resolve) => {
          if (!this.audio) return resolve();
          const a = this.audio;
          const onEnd = () => {
            a.removeEventListener("ended", onEnd);
            a.removeEventListener("error", onEnd);
            resolve();
          };
          a.addEventListener("ended", onEnd);
          a.addEventListener("error", onEnd);
        });
        try {
          if (next.url) URL.revokeObjectURL(next.url);
        } catch {
          /* ignore */
        }
        if (this.aborted) return;
      }
    } finally {
      this.running = false;
    }
  }

  private setStatus(s: TransportState["status"]) {
    this.status = s;
    try {
      this.prefs.onTransport?.(this.state());
    } catch {
      /* ignore */
    }
    this.updateMediaSession();
  }

  /**
   * Wire up the OS Media Session so the lock screen / AirPods / Bluetooth
   * controls can pause/resume/skip the running TTS playback.
   */
  private updateMediaSession() {
    if (typeof navigator === "undefined") return;
    const ms = navigator.mediaSession;
    if (!ms) return;
    try {
      // Reflect the current playback status on the lock screen.
      ms.playbackState =
        this.status === "playing"
          ? "playing"
          : this.status === "paused"
            ? "paused"
            : "none";

      // Show the most recent assistant text as the "track title" so the
      // lock screen displays a useful preview instead of "Untitled".
      const title =
        this.current?.text?.slice(0, 80) ||
        this.lastTurnText.slice(0, 80) ||
        "Claude is talking…";
      ms.metadata = new MediaMetadata({
        title,
        artist: "Claude",
        album: "Claude Talk",
        artwork: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      });

      // Action handlers — registered once. Re-registering each time is fine,
      // the browser just replaces the prior handler.
      ms.setActionHandler("play", () => this.resume());
      ms.setActionHandler("pause", () => this.pause());
      ms.setActionHandler("stop", () => this.cancel());
      ms.setActionHandler("seekbackward", (d) => this.skip(-(d.seekOffset ?? 10)));
      ms.setActionHandler("seekforward", (d) => this.skip(d.seekOffset ?? 10));
      ms.setActionHandler("previoustrack", () => this.replayLast());
    } catch {
      /* MediaSession is best-effort. */
    }
  }
}
