import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canTransition,
  InvalidTransitionError,
  isTerminal,
  outstandingCriticRequests,
  unreviewedFindings,
  validateManagerAction,
} from "@/lib/orchestration/state-machine";
import { TASK_STATUSES, type Workspace } from "@/lib/domain";
import type { ManagerDecision } from "@/lib/ai/schemas";

function workspace(partial: Partial<Workspace> = {}): Workspace {
  return {
    task: {
      id: "t1",
      objective: "o",
      status: "PLANNING",
      currentStep: null,
      iteration: 1,
      agentCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      provider: "p",
      searchTool: "s",
      demoMode: true,
      finalResult: null,
      error: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      startedAt: null,
      completedAt: null,
    },
    subtasks: [],
    findings: [],
    messages: [],
    decisions: [],
    events: [],
    agentRuns: [],
    ...partial,
  };
}

const finding = (id: string, at = 1) => ({
  id,
  taskId: "t1",
  subtaskId: null,
  agentRunId: null,
  kind: "FINDING" as const,
  title: `F ${id}`,
  content: "c",
  confidence: "medium" as const,
  iteration: 1,
  createdAt: new Date(at),
  evidence: [],
});

const review = (decision: "APPROVED" | "NEEDS_MORE_WORK", reviewed: string[], at = 10, requested: { title: string; description: string }[] = []) => ({
  id: `m${at}`,
  taskId: "t1",
  fromAgent: "critic" as const,
  toAgent: "manager" as const,
  type: decision,
  content: "summary",
  reason: null,
  metadata: { reviewedFindingIds: reviewed, issues: [], requestedResearch: requested },
  createdAt: new Date(at),
});

const decision = (action: ManagerDecision["action"], tasks: ManagerDecision["tasks"] = []): ManagerDecision => ({
  action,
  reason: "r",
  message: "m",
  tasks,
});

describe("task state machine", () => {
  it("allows the main happy-path transitions", () => {
    const path = ["PENDING", "PLANNING", "RESEARCHING", "PLANNING", "REVIEWING", "NEEDS_MORE_WORK", "PLANNING", "REVIEWING", "PLANNING", "SYNTHESIZING", "COMPLETED"] as const;
    for (let i = 1; i < path.length; i++) expect(() => assertTransition(path[i - 1], path[i])).not.toThrow();
  });

  it("rejects invalid transitions", () => {
    expect(canTransition("PENDING", "COMPLETED")).toBe(false);
    expect(canTransition("RESEARCHING", "SYNTHESIZING")).toBe(false);
    expect(canTransition("REVIEWING", "COMPLETED")).toBe(false);
    expect(() => assertTransition("PLANNING", "COMPLETED")).toThrow(InvalidTransitionError);
  });

  it("treats terminal states as final", () => {
    for (const s of ["COMPLETED", "FAILED", "FAILED_REQUIRES_REVIEW"] as const) {
      expect(isTerminal(s)).toBe(true);
      for (const to of TASK_STATUSES) expect(canTransition(s, to)).toBe(false);
    }
  });

  it("lets every non-terminal state escalate to FAILED_REQUIRES_REVIEW", () => {
    for (const s of TASK_STATUSES.filter((x) => !isTerminal(x))) expect(canTransition(s, "FAILED_REQUIRES_REVIEW")).toBe(true);
  });
});

describe("workspace queries", () => {
  it("tracks which findings the critic has not seen", () => {
    const ws = workspace({ findings: [finding("a"), finding("b"), finding("c", 20)], messages: [review("NEEDS_MORE_WORK", ["a", "b"])] });
    expect(unreviewedFindings(ws).map((f) => f.id)).toEqual(["c"]);
  });

  it("computes critic requests that have not been assigned yet", () => {
    const ws = workspace({
      messages: [review("NEEDS_MORE_WORK", [], 10, [{ title: "Tourist pricing", description: "d" }, { title: "Booking channels", description: "d" }])],
      subtasks: [
        { id: "s", taskId: "t1", title: "tourist pricing", description: "d", assignedTo: "researcher", origin: "critic", status: "PENDING", iteration: 2, createdAt: new Date(11), completedAt: null },
      ],
    });
    expect(outstandingCriticRequests(ws).map((r) => r.title)).toEqual(["Booking channels"]);
  });
});

describe("manager action guard (completion criteria)", () => {
  it("rejects COMPLETE before any review", () => {
    const res = validateManagerAction(decision("COMPLETE"), workspace({ findings: [finding("a")] }));
    expect(res.ok).toBe(false);
  });

  it("rejects COMPLETE when the latest review asked for more work", () => {
    const ws = workspace({ findings: [finding("a")], messages: [review("NEEDS_MORE_WORK", ["a"])] });
    expect(validateManagerAction(decision("COMPLETE"), ws).ok).toBe(false);
  });

  it("rejects COMPLETE when findings were added after approval", () => {
    const ws = workspace({ findings: [finding("a"), finding("b", 20)], messages: [review("APPROVED", ["a"])] });
    const res = validateManagerAction(decision("COMPLETE"), ws);
    expect(res).toMatchObject({ ok: false, reason: expect.stringMatching(/after the critic's approval/) });
  });

  it("accepts COMPLETE after approval of all findings", () => {
    const ws = workspace({ findings: [finding("a")], messages: [review("APPROVED", ["a"])] });
    expect(validateManagerAction(decision("COMPLETE"), ws).ok).toBe(true);
  });

  it("rejects REQUEST_REVIEW when nothing new needs review", () => {
    expect(validateManagerAction(decision("REQUEST_REVIEW"), workspace()).ok).toBe(false);
    expect(validateManagerAction(decision("REQUEST_REVIEW"), workspace({ findings: [finding("a")] })).ok).toBe(true);
  });

  it("rejects research assignments that only duplicate completed work", () => {
    const ws = workspace({
      subtasks: [{ id: "s", taskId: "t1", title: "Identify competitors", description: "d", assignedTo: "researcher", origin: "manager", status: "COMPLETED", iteration: 1, createdAt: new Date(1), completedAt: new Date(2) }],
    });
    expect(validateManagerAction(decision("ASSIGN_RESEARCH", [{ title: "identify competitors!", description: "d" }]), ws).ok).toBe(false);
    expect(validateManagerAction(decision("ASSIGN_RESEARCH", [{ title: "Tourist pricing", description: "d" }]), ws).ok).toBe(true);
  });

  it("always allows FAIL", () => {
    expect(validateManagerAction(decision("FAIL"), workspace()).ok).toBe(true);
  });
});
