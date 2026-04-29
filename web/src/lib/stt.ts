import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const WHISPER_MODEL =
  process.env.WHISPER_MODEL ?? "mlx-community/whisper-large-v3-turbo";
const STT_RUNNER = process.env.STT_RUNNER ?? "uvx";

export type TranscribeResult = {
  text: string;
  ms: number;
};

export async function transcribeAudio(buf: Buffer, ext = "webm"): Promise<TranscribeResult> {
  const dir = mkdtempSync(path.join(tmpdir(), "voice-agent-stt-"));
  const inputPath = path.join(dir, `input.${ext}`);
  const wavPath = path.join(dir, `clip.wav`);
  writeFileSync(inputPath, buf);

  // Convert to 16k mono wav with ffmpeg first; mlx-whisper accepts many formats
  // but a clean wav is the most reliable, fastest path.
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
