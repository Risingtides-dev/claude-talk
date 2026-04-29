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
   * Play a tiny "mhm"-style acknowledgment by enqueuing it as the first
   * chunk of the upcoming turn. Goes through the same playback path as real
   * TTS so it inherits the iOS audio unlock (which only applies to the main
   * <audio> element). When real text starts streaming in, it just slots in
   * after the backchannel — no second audio element, no separate unlock.
   */
  playBackchannel() {
    if (this.aborted) return;
    // If a real chunk is already queued or playing, don't insert filler.
    if (this.queue.length > 0 || this.current) return;
    const phrase =
      BACKCHANNEL_PHRASES[Math.floor(Math.random() * BACKCHANNEL_PHRASES.length)];
    if (phrase) this.enqueueChunk(phrase);
  }

  /** No-op kept for callsite compatibility. Backchannel now plays through the
   * main queue, so any real chunk naturally lines up after it without
   * needing a separate cancel path. */
  cancelBackchannel() {
    /* intentional no-op */
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
   * controls can pause/resume/skip the running TTS playback. Cheap on every
   * call: state + metadata only update when they actually change, action
   * handlers register exactly once.
   */
  private mediaSessionHandlersBound = false;
  private lastMediaTitle = "";
  private lastMediaState: "playing" | "paused" | "none" = "none";
  private updateMediaSession() {
    if (typeof navigator === "undefined") return;
    const ms = navigator.mediaSession;
    if (!ms) return;
    try {
      const desired: "playing" | "paused" | "none" =
        this.status === "playing"
          ? "playing"
          : this.status === "paused"
            ? "paused"
            : "none";
      if (desired !== this.lastMediaState) {
        ms.playbackState = desired;
        this.lastMediaState = desired;
      }

      const title =
        this.current?.text?.slice(0, 80) ||
        this.lastTurnText.slice(0, 80) ||
        "Claude is talking…";
      if (title !== this.lastMediaTitle) {
        ms.metadata = new MediaMetadata({
          title,
          artist: "Claude",
          album: "Claude Talk",
          artwork: [
            { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          ],
        });
        this.lastMediaTitle = title;
      }

      if (!this.mediaSessionHandlersBound) {
        ms.setActionHandler("play", () => this.resume());
        ms.setActionHandler("pause", () => this.pause());
        ms.setActionHandler("stop", () => this.cancel());
        ms.setActionHandler("seekbackward", (d) =>
          this.skip(-(d.seekOffset ?? 10)),
        );
        ms.setActionHandler("seekforward", (d) =>
          this.skip(d.seekOffset ?? 10),
        );
        ms.setActionHandler("previoustrack", () => this.replayLast());
        this.mediaSessionHandlersBound = true;
      }
    } catch {
      /* MediaSession is best-effort. */
    }
  }
}
