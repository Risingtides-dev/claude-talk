import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const HOME = os.homedir();

function safeCwd(p: string): string {
  let resolved = path.resolve(p);
  try {
    resolved = fs.realpathSync.native(resolved);
  } catch {
    /* keep raw resolved */
  }
  if (resolved !== HOME && !resolved.startsWith(HOME + path.sep)) {
    throw new Error("cwd outside home");
  }
  return resolved;
}

function safeName(name: string): string {
  // Drop any path traversal, keep alnum/dot/dash/underscore.
  const base = name.split(/[\\/]/).pop() ?? "file";
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200) || "file";
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart" }, { status: 400 });
  }

  const cwdRaw = form.get("cwd");
  if (typeof cwdRaw !== "string" || !cwdRaw) {
    return NextResponse.json({ error: "cwd required" }, { status: 400 });
  }
  let cwd: string;
  try {
    cwd = safeCwd(cwdRaw);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  const ab = await file.arrayBuffer();
  const buf = Buffer.from(ab);
  if (buf.length === 0) {
    return NextResponse.json({ error: "empty file" }, { status: 400 });
  }
  const fileName = safeName(
    file instanceof File ? file.name : `upload-${Date.now()}`,
  );

  const dir = path.join(cwd, ".attachments");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  const finalName = `${stamp}_${fileName}`;
  const finalPath = path.join(dir, finalName);
  fs.writeFileSync(finalPath, buf);

  return NextResponse.json({
    path: finalPath,
    relativePath: path.relative(cwd, finalPath),
    size: buf.length,
  });
}
