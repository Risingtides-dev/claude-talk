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
  text: string;
  url: string;       // object URL for the decoded WAV
  duration: number;  // seconds
};

export class Speaker {
  private prefs: SpeakerPrefs;
  private audio: HTMLAudioElement | null = null;
  private queue: Job[] = [];
  private current: Job | null = null;
  private running = false;
  private aborted = false;
  private status: TransportState["status"] = "idle";
  private lastTurnText = "";

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
    // Loading a 1-frame silent data URI inside a gesture is enough to mark the
    // <audio> element as user-allowed for future src changes + plays on iOS.
    try {
      const a = this.audio;
      if (!a.dataset.unlocked) {
        a.muted = true;
        a.src =
          "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
        const p = a.play();
        if (p && typeof p.then === "function") {
          p.then(() => {
            a.pause();
            a.muted = false;
            a.dataset.unlocked = "1";
          }).catch(() => {
            a.muted = false;
          });
        }
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

  /** Append a chunk and play it back when its turn comes up in the queue. */
  enqueueChunk(text: string) {
    const t = text.trim();
    if (!t) return;
    this.aborted = false;
    this.lastTurnText = (this.lastTurnText + " " + t).trim();
    if (this.status === "idle") this.setStatus("loading");
    void this.fetchAndQueue(t);
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
    this.cancel();
    this.aborted = false;
    this.setStatus("loading");
    void this.fetchAndQueue(this.lastTurnText);
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

  private async fetchAndQueue(text: string) {
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, voice: this.prefs.voice ?? "claude" }),
      });
      if (!res.ok) return;
      const ab = await res.arrayBuffer();
      const blob = new Blob([new Uint8Array(ab)], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);
      // Get duration without playing — load metadata only.
      const dur = await this.probeDuration(url);
      this.queue.push({ text, url, duration: dur });
      void this.tick();
    } catch {
      /* ignore */
    }
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
        const next = this.queue.shift();
        if (!next) {
          this.current = null;
          this.setStatus("idle");
          this.prefs.onIdle?.();
          return;
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
          URL.revokeObjectURL(next.url);
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
  }
}
