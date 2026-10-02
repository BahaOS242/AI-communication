import { describe, expect, it } from "vitest";
import {
  AgentMessageSchema,
  CriticReviewSchema,
  FinalSynthesisSchema,
  ManagerDecisionSchema,
  ResearchQueriesSchema,
  ResearchReportSchema,
} from "@/lib/ai/schemas";

describe("manager decision schema", () => {
  it("accepts each valid action", () => {
    expect(ManagerDecisionSchema.safeParse({ action: "ASSIGN_RESEARCH", reason: "r", message: "m", tasks: [{ title: "t", description: "d" }] }).success).toBe(true);
    for (const action of ["REQUEST_REVIEW", "COMPLETE", "FAIL"]) {
      expect(ManagerDecisionSchema.safeParse({ action, reason: "r", message: "m", tasks: [] }).success).toBe(true);
    }
  });

  it("requires tasks for ASSIGN_RESEARCH", () => {
    const r = ManagerDecisionSchema.safeParse({ action: "ASSIGN_RESEARCH", reason: "r", message: "m", tasks: [] });
    expect(r.success).toBe(false);
  });

  it("rejects unknown actions, empty reasons and too many tasks", () => {
    expect(ManagerDecisionSchema.safeParse({ action: "WRITE_ESSAY", reason: "r", message: "m", tasks: [] }).success).toBe(false);
    expect(ManagerDecisionSchema.safeParse({ action: "FAIL", reason: "  ", message: "m", tasks: [] }).success).toBe(false);
    const tasks = Array.from({ length: 5 }, (_, i) => ({ title: `t${i}`, description: "d" }));
    expect(ManagerDecisionSchema.safeParse({ action: "ASSIGN_RESEARCH", reason: "r", message: "m", tasks }).success).toBe(false);
  });
});

describe("researcher schemas", () => {
  it("validates queries", () => {
    expect(ResearchQueriesSchema.safeParse({ queries: ["a"], rationale: "r" }).success).toBe(true);
    expect(ResearchQueriesSchema.safeParse({ queries: [], rationale: "r" }).success).toBe(false);
    expect(ResearchQueriesSchema.safeParse({ queries: ["a", "b", "c", "d"], rationale: "r" }).success).toBe(false);
  });

  it("requires findings when COMPLETED and a reason when BLOCKED", () => {
    const base = { summary: "s", uncertainties: [] };
    expect(ResearchReportSchema.safeParse({ ...base, status: "COMPLETED", findings: [] }).success).toBe(false);
    expect(ResearchReportSchema.safeParse({ ...base, status: "BLOCKED", findings: [] }).success).toBe(false);
    expect(ResearchReportSchema.safeParse({ ...base, status: "BLOCKED", findings: [], blockedReason: "no data" }).success).toBe(true);
    expect(
      ResearchReportSchema.safeParse({
        ...base,
        status: "COMPLETED",
        findings: [{ title: "t", content: "c", confidence: "high", sourceIds: ["S1"] }],
      }).success,
    ).toBe(true);
  });

  it("rejects invalid confidence values", () => {
    const r = ResearchReportSchema.safeParse({
      status: "COMPLETED",
      summary: "s",
      uncertainties: [],
      findings: [{ title: "t", content: "c", confidence: "certain", sourceIds: [] }],
    });
    expect(r.success).toBe(false);
  });
});

describe("critic schema", () => {
  it("requires requested research when NEEDS_MORE_WORK", () => {
    expect(CriticReviewSchema.safeParse({ decision: "NEEDS_MORE_WORK", summary: "s", issues: [], requestedResearch: [] }).success).toBe(false);
    expect(
      CriticReviewSchema.safeParse({
        decision: "NEEDS_MORE_WORK",
        summary: "s",
        issues: [{ type: "MISSING_INFORMATION", description: "d", severity: "high" }],
        requestedResearch: [{ title: "t", description: "d" }],
      }).success,
    ).toBe(true);
  });

  it("accepts APPROVED with no requests and rejects unknown issue types", () => {
    expect(CriticReviewSchema.safeParse({ decision: "APPROVED", summary: "s", issues: [], requestedResearch: [] }).success).toBe(true);
    expect(
      CriticReviewSchema.safeParse({
        decision: "APPROVED",
        summary: "s",
        issues: [{ type: "VIBES", description: "d", severity: "low" }],
        requestedResearch: [],
      }).success,
    ).toBe(false);
  });
});

describe("final synthesis schema", () => {
  it("requires at least one key finding", () => {
    const base = { summary: "s", uncertainties: [], recommendations: [], conclusion: "c", confidence: "low" };
    expect(FinalSynthesisSchema.safeParse({ ...base, keyFindings: [] }).success).toBe(false);
    expect(FinalSynthesisSchema.safeParse({ ...base, keyFindings: [{ title: "t", detail: "d", sourceIds: [] }] }).success).toBe(true);
  });
});

describe("agent message schema", () => {
  const valid = { taskId: "t", fromAgent: "critic", toAgent: "manager", type: "NEEDS_MORE_WORK", content: "Missing pricing", reason: "r" };

  it("accepts a well-formed message", () => {
    expect(AgentMessageSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects unknown agents, unknown types and empty content", () => {
    expect(AgentMessageSchema.safeParse({ ...valid, fromAgent: "intern" }).success).toBe(false);
    expect(AgentMessageSchema.safeParse({ ...valid, type: "GOSSIP" }).success).toBe(false);
    expect(AgentMessageSchema.safeParse({ ...valid, content: "" }).success).toBe(false);
  });
});
