import type { TaskSnapshot } from "@/lib/snapshot";
import { AGENT_META, Badge, Card, cn } from "./ui";

const SUBTASK_STATUS: Record<string, { icon: string; cls: string }> = {
  PENDING: { icon: "○", cls: "text-faint" },
  IN_PROGRESS: { icon: "●", cls: "text-researcher animate-pulse-dot" },
  COMPLETED: { icon: "✓", cls: "text-emerald-300" },
  BLOCKED: { icon: "⚠", cls: "text-orange-300" },
  FAILED: { icon: "✕", cls: "text-red-300" },
};

/** The shared workspace: subtasks and counts of what the team has produced. */
export function WorkspacePanel({ snapshot }: { snapshot: TaskSnapshot }) {
  const findings = snapshot.findings.filter((f) => f.kind === "FINDING");
  const uncertainties = snapshot.findings.filter((f) => f.kind === "UNCERTAINTY");
  const sources = new Set(findings.flatMap((f) => f.evidence.map((e) => e.sourceId)));
  return (
    <Card title="Shared workspace">
      <div className="grid grid-cols-3 divide-x divide-line border-b border-line text-center">
        {[
          ["Findings", findings.length],
          ["Sources", sources.size],
          ["Open questions", uncertainties.length],
        ].map(([label, n]) => (
          <div key={label} className="py-3">
            <p className="text-lg font-semibold text-ink">{n}</p>
            <p className="text-[11px] text-faint">{label}</p>
          </div>
        ))}
      </div>
      <ul className="space-y-1 p-3">
        {snapshot.subtasks.length === 0 && <li className="px-1 py-2 text-xs text-faint">The manager hasn&apos;t planned yet.</li>}
        {snapshot.subtasks.map((s) => (
          <li key={s.id} className="flex items-start gap-2 rounded-md px-1 py-1.5">
            <span className={cn("mt-0.5 w-3 text-center text-xs", SUBTASK_STATUS[s.status].cls)}>{SUBTASK_STATUS[s.status].icon}</span>
            <span className="flex-1 text-[13px] leading-snug text-ink/90">{s.title}</span>
            {s.origin === "critic" && <Badge className={cn(AGENT_META.critic.bg, AGENT_META.critic.text, AGENT_META.critic.ring)}>critic</Badge>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
