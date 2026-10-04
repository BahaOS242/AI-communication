"use client";

import { useEffect, useRef } from "react";
import type { TaskSnapshot } from "@/lib/snapshot";
import { AGENT_META, AgentAvatar, Card, cn } from "./ui";

type Event = TaskSnapshot["events"][number];
type Tone = "working" | "done" | "warn" | "error" | "info";

const TONE: Record<Tone, { icon: string; cls: string }> = {
  working: { icon: "●", cls: "text-researcher" },
  done: { icon: "✓", cls: "text-emerald-300" },
  warn: { icon: "⚠", cls: "text-orange-300" },
  error: { icon: "✕", cls: "text-red-300" },
  info: { icon: "›", cls: "text-faint" },
};

/** Map raw events to the human-readable activity feed. Returns null to hide an event. */
function describe(e: Event): { tone: Tone; text: string } | null {
  switch (e.type) {
    case "TASK_CREATED":
      return { tone: "info", text: "Objective received" };
    case "MANAGER_STARTED":
      return { tone: "working", text: "Thinking about the next step…" };
    case "MANAGER_PLANNED":
      return { tone: "done", text: e.message };
    case "MANAGER_DECIDED":
      return { tone: "info", text: e.message.split(":")[0].replaceAll("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) };
    case "MANAGER_REASSIGNED_TASK":
      return { tone: "warn", text: e.message };
    case "MANAGER_ACTION_REJECTED":
      return { tone: "warn", text: e.message };
    case "AGENT_STARTED":
      return e.agent === "manager" ? null : { tone: "working", text: e.message };
    case "AGENT_COMPLETED":
      return e.agent === "manager" && e.data?.purpose === "decide"
        ? null
        : { tone: "done", text: e.agent === "researcher" ? "Research completed" : e.agent === "critic" ? "Review completed" : "Final result written" };
    case "TOOL_CALLED":
      return { tone: "info", text: `🔍 ${e.message}` };
    case "AGENT_RETRY":
      return { tone: "warn", text: e.message };
    case "AGENT_FAILED":
      return { tone: "error", text: e.message };
    case "CRITIC_REQUESTED_MORE_WORK":
      return { tone: "warn", text: `Additional research required: ${e.message}` };
    case "CRITIC_APPROVED":
      return { tone: "done", text: "Research approved" };
    case "LIMIT_REACHED":
      return { tone: "error", text: e.message };
    case "TASK_COMPLETED":
      return { tone: "done", text: "Task completed" };
    case "TASK_FAILED":
      return { tone: "error", text: e.message };
    default:
      return null;
  }
}

export function AgentActivity({ snapshot, live }: { snapshot: TaskSnapshot; live: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const items = snapshot.events
    .map((e) => ({ e, d: describe(e) }))
    .filter((x): x is { e: Event; d: { tone: Tone; text: string } } => x.d !== null);

  useEffect(() => {
    // Scroll inside the panel only; never move the page itself.
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [items.length]);

  return (
    <Card title="Agent activity" action={<span className="text-[11px] text-faint">{items.length} events</span>}>
      <div ref={scroller} className="scroll-thin max-h-[420px] overflow-y-auto px-2 py-2">
        <ol className="space-y-0.5">
          {items.map(({ e, d }, i) => {
            const isLast = i === items.length - 1;
            const agent = e.agent ?? "system";
            return (
              <li key={e.id} className="flex animate-fade-in items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-white/[0.02]">
                <span
                  className={cn(
                    "mt-0.5 w-3 text-center text-xs",
                    d.tone === "working" && !(isLast && live) ? "text-faint" : TONE[d.tone].cls,
                    d.tone === "working" && isLast && live && "animate-pulse-dot",
                  )}
                >
                  {TONE[d.tone].icon}
                </span>
                <div className="min-w-0 flex-1">
                  <span className={cn("text-xs font-semibold", AGENT_META[agent].text)}>{AGENT_META[agent].label}</span>
                  <p className="text-[13px] leading-snug text-ink/85">{d.text}</p>
                </div>
              </li>
            );
          })}
        </ol>
              </div>
    </Card>
  );
}

export function AgentRoster({ snapshot }: { snapshot: TaskSnapshot }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {snapshot.agents.map((a) => (
        <div
          key={a.agent}
          className={cn(
            "rounded-xl border bg-panel p-3 transition",
            a.state === "working" ? `${AGENT_META[a.agent].ring} ring-1 border-transparent` : "border-line",
          )}
        >
          <div className="flex items-center justify-between">
            <AgentAvatar agent={a.agent} size="sm" />
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                a.state === "working" && `${AGENT_META[a.agent].dot} animate-pulse-dot`,
                a.state === "done" && "bg-emerald-400/70",
                a.state === "failed" && "bg-red-400",
                a.state === "idle" && "bg-faint/50",
              )}
            />
          </div>
          <p className={cn("mt-2 text-sm font-semibold", AGENT_META[a.agent].text)}>{AGENT_META[a.agent].label}</p>
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-tight text-muted">{a.state === "working" ? a.activity : a.state === "idle" ? "Waiting" : `${a.runs} run${a.runs === 1 ? "" : "s"}`}</p>
        </div>
      ))}
    </div>
  );
}
