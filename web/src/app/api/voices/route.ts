import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PROJECT_ROOT = process.env.VOICE_AGENT_ROOT ?? process.cwd();
const VOICES_DIR = path.join(PROJECT_ROOT, "voices");

type VoiceMeta = {
  name: string;
  hasEmbedding: boolean;
  hasAudio: boolean;
  sizeKb: number;
};

export async function GET() {
  if (!fs.existsSync(VOICES_DIR)) {
    return NextResponse.json({ voices: [] as VoiceMeta[] });
  }
  const files = fs.readdirSync(VOICES_DIR);
  const byName = new Map<string, VoiceMeta>();
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    const base = path.basename(f, ext);
    if (![".safetensors", ".wav", ".mp3", ".ogg", ".flac"].includes(ext)) continue;
    const full = path.join(VOICES_DIR, f);
    let size = 0;
    try {
      size = fs.statSync(full).size;
    } catch {
      /* skip */
    }
    const existing = byName.get(base) ?? {
      name: base,
      hasEmbedding: false,
      hasAudio: false,
      sizeKb: 0,
    };
    if (ext === ".safetensors") existing.hasEmbedding = true;
    else existing.hasAudio = true;
    existing.sizeKb = Math.round((existing.sizeKb * 1024 + size) / 1024);
    byName.set(base, existing);
  }
  const voices = Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ voices });
}
