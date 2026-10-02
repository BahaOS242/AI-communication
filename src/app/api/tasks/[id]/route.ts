import { NextResponse } from "next/server";
import { getRepository } from "@/lib/orchestration/service";
import { toTaskSnapshot } from "@/lib/orchestration/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ws = await getRepository().getWorkspace(id);
  if (!ws) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  return NextResponse.json(toTaskSnapshot(ws));
}
