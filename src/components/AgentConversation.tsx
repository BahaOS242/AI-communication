"use client";

import { useEffect, useRef } from "react";
import type { TaskSnapshot } from "@/lib/snapshot";
import { AGENT_META, AgentAvatar, Badge, Card, cn } from "./ui";

type Message = TaskSnapshot["messages"][number];

const TYPE_STYLE: Record<string, string> = {
  OBJECTIVE: "bg-user/10 text-user ring-user/30",
  PLAN: "bg-manager/10 text-manager ring-manager/30",
  ASSIGNMENT: "bg-manager/10 text-manager ring-manager/30",
  REVIEW_REQUEST: "bg-manager/10 text-manager ring-manager/30",
  DECISION: "bg-manager/10 text-manager ring-manager/30",
  RESEARCH_RESULT: "bg-researcher/10 text-researcher ring-researcher/30",
  BLOCKED: "bg-orange-400/10 text-orange-300 ring-orange-400/30",
  APPROVED: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/30",
  NEEDS_MORE_WORK: "bg-orange-400/10 text-orange-300 ring-orange-400/30",
  REJECTED_ACTION: "bg-orange-400/10 text-orange-300 ring-orange-400/30",
  AGENT_FAILED: "bg-red-400/10 text-red-300 ring-red-400/30",
  FINAL_RESULT: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/30",
};

interface Meta {
  tasks?: { title: string; description: string }[];
  findings?: { title: string; confidence: string; sourceIds: string[] }[];
  queries?: string[];
  issues?: { type: string; description: string; severity: string }[];
  requestedResearch?: { title: string; description: string }[];
  droppedSourceIds?: string[];
}

const SEVERITY: Record<string, string> = {
  high: "bg-red-400/10 text-red-300 ring-red-400/30",
  medium: "bg-orange-400/10 text-orange-300 ring-orange-400/30",
  low: "bg-white/5 text-muted ring-white/10",
};

function MessageDetails({ message }: { message: Message }) {
  const meta = (message.metadata ?? {}) as Meta;
  return (
    <div className="mt-2 space-y-2">
      {meta.tasks && meta.tasks.length > 0 && (
        <ol className="space-y-1.5">
          {meta.tasks.map((t, i) => (
            <li key={i} className="rounded-lg border border-line bg-canvas/40 px-3 py-2">
              <p className="text-[13px] font-medium text-ink">
                <span className="mr-1.5 font-mono text-xs text-faint">{i + 1}.</span>
                {t.title}
              </p>
              <p className="mt-0.5 text-xs text-muted">{t.description}</p>
            </li>
          ))}
        </ol>
      )}
      {meta.queries && meta.queries.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {meta.queries.map((q) => (
            <Badge key={q}>🔍 {q}</Badge>
          ))}
        </div>
      )}
      {meta.findings && meta.findings.length > 0 && (
        <ul className="space-y-1">
          {meta.findings.map((f, i) => (
            <li key={i} className="flex items-start gap-2 text-[13px] text-ink/90">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-researcher" />
              <span className="flex-1">{f.title}</span>
              <span className="flex shrink-0 gap-1">
                {f.sourceIds.map((s) => (
                  <Badge key={s} className="bg-researcher/5 font-mono text-researcher ring-researcher/20">{s}</Badge>
                ))}
                <Badge className={SEVERITY[f.confidence === "high" ? "low" : f.confidence === "low" ? "high" : "medium"]}>{f.confidence}</Badge>
              </span>
            </li>
          ))}
        </ul>
      )}
      {meta.issues && meta.issues.length > 0 && (
        <ul className="space-y-1.5">
          {meta.issues.map((issue, i) => (
            <li key={i} className="flex items-start gap-2 text-[13px]">
              <Badge className={SEVERITY[issue.severity]}>{issue.severity}</Badge>
              <span className="text-ink/90">
                <span className="mr-1 font-mono text-[11px] text-faint">{issue.type}</span>
                {issue.description}
              </span>
            </li>
          ))}
        </ul>
      )}
      {meta.requestedResearch && meta.requestedResearch.length > 0 && (
        <div className="rounded-lg border border-orange-400/20 bg-orange-400/5 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-orange-300">Requested research</p>
          <ul className="mt-1 space-y-0.5">
            {meta.requestedResearch.map((r, i) => (
              <li key={i} className="text-[13px] text-ink/90">→ {r.title}</li>
            ))}
          </ul>
        </div>
      )}
      {meta.droppedSourceIds && meta.droppedSourceIds.length > 0 && (
        <p className="text-xs text-orange-300">Removed citations to unknown sources: {meta.droppedSourceIds.join(", ")}</p>
      )}
    </div>
  );
}

export function AgentConversation({ snapshot, live }: { snapshot: TaskSnapshot; live: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  const working = snapshot.agents.find((a) => a.state === "working");

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [snapshot.messages.length, working?.agent]);

  return (
    <Card title="Agent conversation" action={<span className="text-[11px] text-faint">{snapshot.messages.length} messages</span>}>
      <div className="scroll-thin max-h-[640px] space-y-1 overflow-y-auto p-3">
        {snapshot.messages.map((m) => {
          const from = AGENT_META[m.fromAgent];
          return (
            <article key={m.id} className="flex animate-fade-in gap-3 rounded-lg px-2 py-2.5 hover:bg-white/[0.015]">
              <AgentAvatar agent={m.fromAgent} />
              <div className="min-w-0 flex-1">
                <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className={cn("text-xs font-bold uppercase tracking-wider", from.text)}>{from.label}</span>
                  <span className="text-xs text-faint">→ {AGENT_META[m.toAgent].label}</span>
                  <Badge className={TYPE_STYLE[m.type]}>{m.type.replaceAll("_", " ")}</Badge>
                  <time className="ml-auto text-[11px] text-faint">{new Date(m.createdAt).toLocaleTimeString()}</time>
                </header>
                <p className="mt-1 whitespace-pre-wrap text-[14px] leading-relaxed text-ink/95">{m.content}</p>
                {m.reason && m.type !== "NEEDS_MORE_WORK" && m.type !== "APPROVED" && (
                  <p className="mt-1 text-xs text-muted">
                    <span className="font-semibold text-faint">Why: </span>
                    {m.reason}
                  </p>
                )}
                <MessageDetails message={m} />
              </div>
            </article>
          );
        })}
        {live && working && (
          <div className="flex items-center gap-3 px-2 py-2.5 text-sm text-muted">
            <AgentAvatar agent={working.agent} />
            <span className={cn("font-semibold", AGENT_META[working.agent].text)}>{AGENT_META[working.agent].label}</span>
            <span className="truncate">{working.activity}</span>
            <span className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span key={i} className={cn("h-1.5 w-1.5 animate-pulse-dot rounded-full", AGENT_META[working.agent].dot)} style={{ animationDelay: `${i * 0.18}s` }} />
              ))}
            </span>
          </div>
        )}
        <div ref={end} />
      </div>
    </Card>
  );
}
