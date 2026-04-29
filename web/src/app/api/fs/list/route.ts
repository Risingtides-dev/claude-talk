import { NextRequest, NextResponse } from "next/server";
import os from "node:os";
import { listDir } from "@/lib/fs-list";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const dir = req.nextUrl.searchParams.get("dir") ?? os.homedir();
  const showHidden = req.nextUrl.searchParams.get("hidden") === "1";
  try {
    const result = listDir(dir, { showHidden });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 },
    );
  }
}
