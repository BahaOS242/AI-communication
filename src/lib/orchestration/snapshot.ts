import { AGENT_NAMES, type Workspace } from "../domain";
import type { AgentStatus, TaskSnapshot } from "../snapshot";
import { isTerminal } from "./state-machine";

const PURPOSE_LABEL: Record<string, string> = {
  decide: "Deciding next step",
  research: "Researching",
  review: "Reviewing findings",
  synthesize: "Writing final result",
};

export function deriveAgentStatuses(ws: Workspace): AgentStatus[] {
  return AGENT_NAMES.map((agent) => {
    const runs = ws.agentRuns.filter((r) => r.agent === agent);
    const last = runs[runs.length - 1];
    if (!last) return { agent, state: "idle", activity: "Waiting", runs: 0 };
    if (last.status === "RUNNING" && !isTerminal(ws.task.status)) {
      return { agent, state: "working", activity: ws.task.currentStep ?? PURPOSE_LABEL[last.purpose] ?? last.purpose, runs: runs.length };
    }
    if (last.status === "FAILED") return { agent, state: "failed", activity: last.error ?? "Failed", runs: runs.length };
    return { agent, state: "done", activity: `${PURPOSE_LABEL[last.purpose] ?? last.purpose} — done`, runs: runs.length };
  });
}

export function toTaskSnapshot(ws: Workspace): TaskSnapshot {
  const plain = JSON.parse(JSON.stringify(ws)) as Omit<TaskSnapshot, "agents">;
  return { ...plain, agents: deriveAgentStatuses(ws) };
}
