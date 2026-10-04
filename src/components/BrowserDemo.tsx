"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { DemoProvider } from "@/lib/ai/providers/demo";
import { DEFAULT_LIMITS } from "@/lib/config";
import { OrchestrationEngine } from "@/lib/orchestration/engine";
import { InMemoryTaskRepository } from "@/lib/orchestration/memory-repository";
import { toTaskSnapshot } from "@/lib/orchestration/snapshot";
import type { TaskSnapshot } from "@/lib/snapshot";
import { MockSearchTool } from "@/lib/tools/mock-search";
import { TaskView } from "./TaskView";

export const DEFAULT_OBJECTIVE = "Determine whether a tourist-focused Pilates package would be viable in Nassau.";
const REPO_URL = "https://github.com/BahaOS242/AI-communication";

/**
 * Runs the real orchestration engine entirely in the browser: same engine, state
 * machine, schemas and guards as the server, with the scripted demo provider,
 * the offline demo dataset and an in-memory repository. No server or database.
 */
const TERMINAL = new Set(["COMPLETED", "FAILED", "FAILED_REQUIRES_REVIEW"]);

/** Run one task in memory, reporting snapshots until it finishes or is cancelled. */
async function runInBrowser(objective: string, onSnapshot: (s: TaskSnapshot) => void, isCancelled: () => boolean) {
  const repo = new InMemoryTaskRepository();
  const task = await repo.createTask({ objective, provider: "demo:demo-scripted", searchTool: "demo-dataset", demoMode: true });
  await repo.addEvent(task.id, { type: "TASK_CREATED", agent: "user", message: "Objective submitted" });
  await repo.addMessage(task.id, { fromAgent: "user", toAgent: "manager", type: "OBJECTIVE", content: objective });

  const refresh = async () => {
    const ws = await repo.getWorkspace(task.id);
    if (ws && !isCancelled()) onSnapshot(toTaskSnapshot(ws));
  };
  const timer = setInterval(() => void refresh(), 250);
  await refresh();
  const engine = new OrchestrationEngine({
    repo,
    provider: new DemoProvider(),
    search: new MockSearchTool(),
    limits: DEFAULT_LIMITS,
    stepDelayMs: 900,
  });
  await engine.run(task.id);
  clearInterval(timer);
  await refresh();
}

export function BrowserDemo() {
  const params = useSearchParams();
  const objective = (params.get("q") ?? "").trim() || DEFAULT_OBJECTIVE;
  const [snapshot, setSnapshot] = useState<TaskSnapshot | null>(null);
  const [runKey, setRunKey] = useState(0);
  const running = !snapshot || !TERMINAL.has(snapshot.task.status);

  useEffect(() => {
    let cancelled = false;
    void runInBrowser(objective, setSnapshot, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [objective, runKey]);

  const start = () => setRunKey((k) => k + 1);

  const banner = (
    <div className="mb-4 flex flex-col gap-3 rounded-xl border border-critic/25 bg-critic/5 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <p className="text-ink/90">
        <span className="font-semibold text-critic">Live in-browser demo.</span> The real orchestration engine is running in
        your browser, with a scripted model and an offline, illustrative dataset of fictional businesses.
      </p>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={start}
          disabled={running}
          className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-faint disabled:opacity-40"
        >
          {running ? "Running…" : "Run again"}
        </button>
        <a href={REPO_URL} target="_blank" rel="noreferrer" className="rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-canvas hover:bg-white">
          View source
        </a>
      </div>
    </div>
  );

  if (!snapshot) {
    return <p className="p-8 text-sm text-muted">Starting the team…</p>;
  }
  return <TaskView snapshot={snapshot} connection={running ? "live" : "closed"} banner={banner} />;
}

