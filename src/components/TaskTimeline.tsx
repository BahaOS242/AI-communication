import type { TaskSnapshot } from "@/lib/snapshot";
import { AGENT_META, Badge, Card, cn, formatDuration } from "./ui";

function Json({ value }: { value: unknown }) {
  return (
    <pre className="scroll-thin max-h-72 overflow-auto rounded-md bg-canvas p-3 font-mono text-[11px] leading-relaxed text-muted">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/** "How the AI arrived here": every event and every agent run, with inputs and outputs. */
export function TaskTimeline({ snapshot }: { snapshot: TaskSnapshot }) {
  const t0 = new Date(snapshot.task.createdAt).getTime();
  return (
    <Card>
      <details>
        <summary className="flex items-center justify-between px-4 py-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">How the AI arrived here</span>
          <span className="text-[11px] text-faint">
            {snapshot.events.length} events · {snapshot.agentRuns.length} agent runs · {snapshot.decisions.length} decisions ▾
          </span>
        </summary>

        <div className="space-y-6 border-t border-line p-4">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Manager decisions</h3>
            <ol className="space-y-1">
              {snapshot.decisions.map((d) => (
                <li key={d.id} className="flex items-start gap-2 text-[13px]">
                  <span className="w-8 shrink-0 font-mono text-[11px] text-faint">#{d.iteration}</span>
                  <Badge className={d.accepted ? "bg-manager/10 text-manager ring-manager/30" : "bg-orange-400/10 text-orange-300 ring-orange-400/30"}>
                    {d.action}
                  </Badge>
                  <span className={cn("text-ink/85", !d.accepted && "line-through decoration-orange-300/50")}>{d.reason}</span>
                </li>
              ))}
            </ol>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Agent runs</h3>
            <div className="space-y-1">
              {snapshot.agentRuns.map((r) => (
                <details key={r.id} className="rounded-lg border border-line bg-canvas/30">
                  <summary className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[13px]">
                    <span className={cn("w-20 font-semibold", AGENT_META[r.agent].text)}>{AGENT_META[r.agent].label}</span>
                    <span className="w-24 font-mono text-xs text-muted">{r.purpose}</span>
                    <span className="text-xs text-faint">iter {r.iteration}</span>
                    <Badge className={r.status === "COMPLETED" ? "bg-emerald-400/10 text-emerald-300 ring-emerald-400/30" : r.status === "FAILED" ? "bg-red-400/10 text-red-300 ring-red-400/30" : undefined}>
                      {r.status}
                    </Badge>
                    <span className="ml-auto flex gap-3 font-mono text-[11px] text-faint">
                      <span>{r.durationMs !== null ? formatDuration(r.durationMs) : "…"}</span>
                      <span>{r.inputTokens + r.outputTokens} tok</span>
                      <span>{r.attempts} attempt{r.attempts === 1 ? "" : "s"}</span>
                    </span>
                  </summary>
                  <div className="grid gap-3 border-t border-line p-3 lg:grid-cols-2">
                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase text-faint">Input (workspace view)</p>
                      <Json value={r.input} />
                    </div>
                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase text-faint">{r.error ? "Error" : "Output (validated)"}</p>
                      <Json value={r.error ?? r.output} />
                    </div>
                  </div>
                </details>
              ))}
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Event log</h3>
            <ol className="scroll-thin max-h-96 space-y-0.5 overflow-y-auto font-mono text-[11px]">
              {snapshot.events.map((e) => (
                <li key={e.id} className="flex gap-3">
                  <span className="w-8 shrink-0 text-right text-faint">{e.seq}</span>
                  <span className="w-14 shrink-0 text-faint">+{((new Date(e.createdAt).getTime() - t0) / 1000).toFixed(1)}s</span>
                  <span className={cn("w-20 shrink-0", AGENT_META[e.agent ?? "system"].text)}>{e.agent ?? "system"}</span>
                  <span className="w-56 shrink-0 text-ink/80">{e.type}</span>
                  <span className="truncate text-muted">{e.message}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </details>
    </Card>
  );
}
