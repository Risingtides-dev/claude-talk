import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const RUNNER = process.env.TTS_RUNNER ?? "uvx";
const PROJECT_ROOT = process.env.VOICE_AGENT_ROOT ?? process.cwd();
const VOICES_DIR = path.join(PROJECT_ROOT, "voices");
const DEFAULT_VOICE = process.env.TTS_VOICE ?? "claude";

export type GenerateOpts = {
  text: string;
  voice?: string; // basename of file in voices/ (john.safetensors or john.wav)
};

export type GenerateResult = {
  wav: Buffer;
  ms: number;
};

export async function generateSpeech(opts: GenerateOpts): Promise<GenerateResult> {
  const text = opts.text.trim();
  if (!text) throw new Error("empty text");

  const voiceName = opts.voice ?? DEFAULT_VOICE;
  const voicePath = resolveVoicePath(voiceName);
  if (!voicePath) {
    throw new Error(
      `voice '${voiceName}' not found in ${VOICES_DIR} (looked for .safetensors and .wav)`,
    );
  }

  const dir = mkdtempSync(path.join(tmpdir(), "voice-agent-tts-"));
  const out = path.join(dir, "out.wav");

  const args = [
    "--from",
    "pocket-tts",
    "pocket-tts",
    "generate",
    "--text",
    text,
    "--voice",
    voicePath,
    "--output-path",
    out,
    "--quiet",
  ];

  const start = Date.now();
  await runCmd(RUNNER, args);
  const ms = Date.now() - start;

  if (!existsSync(out)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    throw new Error("pocket-tts produced no output");
  }
  const wav = readFileSync(out);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  return { wav, ms };
}

function resolveVoicePath(name: string): string | null {
  // Allow caller to pass either a bare name or a path-like
  const safer = name.replace(/[^a-zA-Z0-9._-]/g, "");
  const candidates = [
    path.join(VOICES_DIR, `${safer}.safetensors`),
    path.join(VOICES_DIR, `${safer}.wav`),
    path.join(VOICES_DIR, `${safer}.mp3`),
  ];
  for (const c of candidates) {
    try {
      if (existsSync(c) && statSync(c).isFile()) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
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
