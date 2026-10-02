import { notFound } from "next/navigation";
import { TaskView } from "@/components/TaskView";
import { getRepository } from "@/lib/orchestration/service";
import { toTaskSnapshot } from "@/lib/orchestration/snapshot";

export const dynamic = "force-dynamic";

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ws = await getRepository().getWorkspace(id);
  if (!ws) notFound();
  return <TaskView initial={toTaskSnapshot(ws)} />;
}
