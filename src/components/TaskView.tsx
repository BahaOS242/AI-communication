"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { TaskSnapshot } from "@/lib/snapshot";
import { AgentActivity, AgentRoster } from "./AgentActivity";
import { AgentConversation } from "./AgentConversation";
import { FinalResult } from "./FinalResult";
import { TaskTimeline } from "./TaskTimeline";
import { Badge, Card, Logo, StatusPill, cn, formatDuration } from "./ui";
import { useTaskStream } from "./useTaskStream";
import { WorkspacePanel } from "./WorkspacePanel";

const TERMINAL = new Set(["COMPLETED", "FAILED", "FAILED_REQUIRES_REVIEW"]);

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function TaskView({ initial }: { initial: TaskSnapshot }) {
  const { snapshot, connection } = useTaskStream(initial.task.id, initial);
  const { task } = snapshot;
  const live = !TERMINAL.has(task.status);
  const now = useNow(live);
  const maxIterations = snapshot.events.find((e) => e.type === "TASK_STARTED")?.data?.limits as { maxIterations?: number } | undefined;
  const started = new Date(task.startedAt ?? task.createdAt).getTime();
  const ended = task.completedAt ? new Date(task.completedAt).getTime() : now;

  const metrics = [
    ["Iteration", `${task.iteration}${maxIterations?.maxIterations ? ` / ${maxIterations.maxIterations}` : ""}`],
    ["Agent calls", String(task.agentCalls)],
    ["Tokens", (task.inputTokens + task.outputTokens).toLocaleString()],
    ["Est. cost", `$${task.estimatedCostUsd.toFixed(4)}`],
    ["Elapsed", formatDuration(Math.max(0, ended - started))],
  ];

  return (
    <main className="mx-auto max-w-7xl px-4 pb-20">
      <nav className="flex items-center justify-between py-5">
        <Link href="/">
          <Logo />
        </Link>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-2 md:flex">
          {task.demoMode && <Badge className="bg-critic/10 text-critic ring-critic/30">Demo mode</Badge>}
          <Badge>{task.provider}</Badge>
          <Badge>search: {task.searchTool}</Badge>
          </span>
          {task.demoMode && <Badge className="bg-critic/10 text-critic ring-critic/30 md:hidden">Demo</Badge>}
          <span className={cn("ml-1 flex items-center gap-1.5 text-[11px]", connection === "live" ? "text-emerald-300" : "text-faint")}>
            <span className={cn("h-1.5 w-1.5 rounded-full bg-current", connection === "live" && "animate-pulse-dot")} />
            {connection === "live" ? "live" : connection === "polling" ? "polling" : "finished"}
          </span>
        </div>
      </nav>

      <Card className="mb-4">
        <div className="flex flex-col gap-4 p-5 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-faint">Task objective</p>
            <h1 className="mt-1 text-xl font-semibold leading-snug text-ink md:text-2xl">{task.objective}</h1>
            <p className="mt-2 text-sm text-muted">{live ? (task.currentStep ?? "Starting…") : task.error ? task.error : "The team has finished."}</p>
          </div>
          <div className="shrink-0 self-start">
            <StatusPill status={task.status} />
          </div>
        </div>
        <dl className="grid grid-cols-2 divide-line border-t border-line sm:grid-cols-5 sm:divide-x">
          {metrics.map(([label, value]) => (
            <div key={label} className="px-5 py-3">
              <dt className="text-[11px] text-faint">{label}</dt>
              <dd className="font-mono text-sm text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <div className="grid gap-4 lg:grid-cols-12">
        <aside className="space-y-4 lg:col-span-4">
          <AgentRoster snapshot={snapshot} />
          <AgentActivity snapshot={snapshot} live={live} />
          <WorkspacePanel snapshot={snapshot} />
        </aside>
        <div className="space-y-4 lg:col-span-8">
          <AgentConversation snapshot={snapshot} live={live} />
          {task.finalResult && <FinalResult result={task.finalResult} />}
          <TaskTimeline snapshot={snapshot} />
        </div>
      </div>
    </main>
  );
}
