import { NextRequest, NextResponse } from "next/server";
import { transcribeAudio } from "@/lib/stt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const ct = req.headers.get("content-type") ?? "";
  let buf: Buffer;
  let ext = "webm";

  if (ct.startsWith("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("audio");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "audio field missing" }, { status: 400 });
    }
    const ab = await file.arrayBuffer();
    buf = Buffer.from(ab);
    if (file instanceof File && file.name.includes(".")) {
      ext = file.name.split(".").pop() ?? ext;
    }
  } else {
    const ab = await req.arrayBuffer();
    buf = Buffer.from(ab);
    if (ct.includes("wav")) ext = "wav";
    else if (ct.includes("mp4") || ct.includes("m4a")) ext = "m4a";
    else if (ct.includes("ogg")) ext = "ogg";
  }

  if (buf.length === 0) {
    return NextResponse.json({ error: "empty audio" }, { status: 400 });
  }

  try {
    const result = await transcribeAudio(buf, ext);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
