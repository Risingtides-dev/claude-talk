import { NextRequest, NextResponse } from "next/server";
import { generateSpeech } from "@/lib/tts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.text !== "string") {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }
  const text = (body.text as string).trim();
  if (!text) {
    return NextResponse.json({ error: "empty text" }, { status: 400 });
  }
  try {
    const { wav, ms } = await generateSpeech({
      text,
      voice: typeof body.voice === "string" ? body.voice : undefined,
    });
    const audio = new Uint8Array(wav.buffer, wav.byteOffset, wav.byteLength);
    return new Response(audio, {
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": String(wav.length),
        "X-TTS-Ms": String(ms),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
