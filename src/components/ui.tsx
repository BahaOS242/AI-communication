import type { ReactNode } from "react";
import type { Participant, Recipient, TaskStatus } from "@/lib/domain";

export function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export const AGENT_META: Record<Recipient, { label: string; text: string; bg: string; ring: string; dot: string }> = {
  manager: { label: "Manager", text: "text-manager", bg: "bg-manager/10", ring: "ring-manager/30", dot: "bg-manager" },
  researcher: { label: "Researcher", text: "text-researcher", bg: "bg-researcher/10", ring: "ring-researcher/30", dot: "bg-researcher" },
  critic: { label: "Critic", text: "text-critic", bg: "bg-critic/10", ring: "ring-critic/30", dot: "bg-critic" },
  system: { label: "System", text: "text-system", bg: "bg-system/10", ring: "ring-system/30", dot: "bg-system" },
  user: { label: "You", text: "text-user", bg: "bg-user/10", ring: "ring-user/30", dot: "bg-user" },
  team: { label: "Team", text: "text-muted", bg: "bg-white/5", ring: "ring-white/10", dot: "bg-muted" },
};

export function Card({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border border-line bg-panel", className)}>
      {title && (
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", className ?? "bg-white/5 text-muted ring-white/10")}>
      {children}
    </span>
  );
}

export function AgentAvatar({ agent, size = "md" }: { agent: Participant | "team"; size?: "sm" | "md" }) {
  const m = AGENT_META[agent];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg font-semibold ring-1 ring-inset",
        m.bg,
        m.text,
        m.ring,
        size === "sm" ? "h-6 w-6 text-[11px]" : "h-8 w-8 text-sm",
      )}
    >
      {m.label[0]}
    </span>
  );
}

const STATUS_STYLE: Record<TaskStatus, { label: string; cls: string; live: boolean }> = {
  PENDING: { label: "Pending", cls: "bg-white/5 text-muted ring-white/10", live: true },
  PLANNING: { label: "Planning", cls: "bg-manager/10 text-manager ring-manager/30", live: true },
  RESEARCHING: { label: "Researching", cls: "bg-researcher/10 text-researcher ring-researcher/30", live: true },
  REVIEWING: { label: "Reviewing", cls: "bg-critic/10 text-critic ring-critic/30", live: true },
  NEEDS_MORE_WORK: { label: "Needs more work", cls: "bg-orange-400/10 text-orange-300 ring-orange-400/30", live: true },
  SYNTHESIZING: { label: "Synthesizing", cls: "bg-manager/10 text-manager ring-manager/30", live: true },
  COMPLETED: { label: "Completed", cls: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/30", live: false },
  FAILED: { label: "Failed", cls: "bg-red-400/10 text-red-300 ring-red-400/30", live: false },
  FAILED_REQUIRES_REVIEW: { label: "Stopped — needs review", cls: "bg-red-400/10 text-red-300 ring-red-400/30", live: false },
};

export function StatusPill({ status }: { status: TaskStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span className={cn("inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset", s.cls)}>
      <span className={cn("h-1.5 w-1.5 rounded-full bg-current", s.live && "animate-pulse-dot")} />
      {s.label}
    </span>
  );
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-manager via-researcher to-critic">
        <span className="h-3 w-3 rounded-sm bg-canvas" />
      </span>
      <span className="text-[15px] font-semibold tracking-tight">AgentForge</span>
    </span>
  );
}

export function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}
