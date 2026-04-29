import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const WHISPER_MODEL =
  process.env.WHISPER_MODEL ?? "mlx-community/whisper-large-v3-turbo";
const STT_RUNNER = process.env.STT_RUNNER ?? "uvx";
const STT_DAEMON_URL = process.env.STT_DAEMON_URL ?? "http://127.0.0.1:7891";

export type TranscribeResult = {
  text: string;
  ms: number;
};

/**
 * Talk to the persistent whisper daemon. Way faster than spawning a fresh
 * uvx process per request because the model stays loaded.
 */
async function transcribeViaDaemon(
  buf: Buffer,
  ext: string,
): Promise<TranscribeResult | null> {
  try {
    const fd = new FormData();
    const blob = new Blob([new Uint8Array(buf)]);
    fd.append("audio", blob, `clip.${ext}`);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 30_000);
    const res = await fetch(`${STT_DAEMON_URL}/transcribe`, {
      method: "POST",
      body: fd,
      signal: ac.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const j = (await res.json()) as { text?: string; ms?: number };
    return { text: (j.text ?? "").trim(), ms: j.ms ?? 0 };
  } catch {
    return null;
  }
}

export async function transcribeAudio(
  buf: Buffer,
  ext = "webm",
): Promise<TranscribeResult> {
  // Try the persistent daemon first; fall back to subprocess if it's down.
  const fast = await transcribeViaDaemon(buf, ext);
  if (fast) return fast;

  const dir = mkdtempSync(path.join(tmpdir(), "voice-agent-stt-"));
  const inputPath = path.join(dir, `input.${ext}`);
  const wavPath = path.join(dir, `clip.wav`);
  writeFileSync(inputPath, buf);

  await runCmd("ffmpeg", [
    "-y",
    "-i",
    inputPath,
    "-ar",
    "16000",
    "-ac",
    "1",
    "-f",
    "wav",
    wavPath,
  ]);

  const args = [
    "--from",
    "mlx-whisper",
    "mlx_whisper",
    wavPath,
    "--model",
    WHISPER_MODEL,
    "--output-format",
    "txt",
    "--output-dir",
    dir,
  ];

  const start = Date.now();
  await runCmd(STT_RUNNER, args);
  const ms = Date.now() - start;

  const txtPath = path.join(dir, "clip.txt");
  let text = "";
  if (existsSync(txtPath)) {
    text = readFileSync(txtPath, "utf8").trim();
  }

  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  return { text, ms };
}

function runCmd(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-2000)}`));
    });
  });
}
