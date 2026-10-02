import { getRepository } from "@/lib/orchestration/service";
import { toTaskSnapshot } from "@/lib/orchestration/snapshot";
import { isTerminal } from "@/lib/orchestration/state-machine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POLL_MS = 600;
const MAX_STREAM_MS = 20 * 60 * 1000;

/**
 * Server-Sent Events: the server watches the task in Postgres and pushes a fresh
 * snapshot whenever something changes. Simple, proxy-friendly, and the DB stays
 * the single source of truth (no in-memory pub/sub to get out of sync).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repo = getRepository();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let lastSignature = "";
      const started = Date.now();
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      try {
        while (!request.signal.aborted && Date.now() - started < MAX_STREAM_MS) {
          const ws = await repo.getWorkspace(id);
          if (!ws) {
            send("error", { error: "Task not found" });
            break;
          }
          const signature = `${ws.task.updatedAt.getTime()}:${ws.events.length}:${ws.messages.length}`;
          if (signature !== lastSignature) {
            lastSignature = signature;
            send("snapshot", toTaskSnapshot(ws));
          } else {
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
          }
          if (isTerminal(ws.task.status)) {
            send("done", { status: ws.task.status });
            break;
          }
          await new Promise((r) => setTimeout(r, POLL_MS));
        }
      } catch (error) {
        send("error", { error: error instanceof Error ? error.message : "Stream failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
