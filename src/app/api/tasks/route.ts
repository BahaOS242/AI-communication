import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepository, startTask } from "@/lib/orchestration/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateTaskSchema = z.object({
  objective: z.string().trim().min(10, "Describe the objective in at least 10 characters").max(2000),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = CreateTaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  try {
    const { id } = await startTask(parsed.data.objective);
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to start task" }, { status: 500 });
  }
}

export async function GET() {
  const tasks = await getRepository().listTasks(20);
  return NextResponse.json({ tasks });
}
