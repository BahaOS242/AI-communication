"use client";

import { useEffect, useState } from "react";
import type { TaskSnapshot } from "@/lib/snapshot";

const TERMINAL = new Set(["COMPLETED", "FAILED", "FAILED_REQUIRES_REVIEW"]);

/**
 * Subscribe to live task snapshots over SSE, falling back to polling if the
 * stream errors (e.g. behind a proxy that buffers responses).
 */
export function useTaskStream(taskId: string, initial: TaskSnapshot) {
  const [snapshot, setSnapshot] = useState(initial);
  const [connection, setConnection] = useState<"live" | "polling" | "closed">(
    TERMINAL.has(initial.task.status) ? "closed" : "live",
  );

  useEffect(() => {
    if (TERMINAL.has(initial.task.status)) return;
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    const source = new EventSource(`/api/tasks/${taskId}/stream`);

    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/tasks/${taskId}`, { cache: "no-store" });
        if (res.ok) {
          const next = (await res.json()) as TaskSnapshot;
          setSnapshot(next);
          if (TERMINAL.has(next.task.status)) {
            setConnection("closed");
            return;
          }
        }
      } catch {
        /* keep polling */
      }
      pollTimer = setTimeout(poll, 1500);
    };

    source.addEventListener("snapshot", (e) => setSnapshot(JSON.parse((e as MessageEvent).data) as TaskSnapshot));
    source.addEventListener("done", () => {
      source.close();
      setConnection("closed");
    });
    source.onerror = () => {
      source.close();
      if (cancelled) return;
      setConnection("polling");
      void poll();
    };

    return () => {
      cancelled = true;
      source.close();
      clearTimeout(pollTimer);
    };
  }, [taskId, initial.task.status]);

  return { snapshot, connection };
}
