import { NextResponse } from "next/server";
import { runtimeInfo } from "@/lib/orchestration/service";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true, ...runtimeInfo() });
}
