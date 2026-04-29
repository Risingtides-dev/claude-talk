import { NextRequest, NextResponse } from "next/server";
import { readSession } from "@/lib/sessions";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const cwd = req.nextUrl.searchParams.get("cwd");
  if (!cwd) {
    return NextResponse.json({ error: "cwd query param required" }, { status: 400 });
  }
  try {
    const messages = await readSession(id, cwd);
    return NextResponse.json({ messages });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
