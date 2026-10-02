import { z } from "zod";

/**
 * Structured output contracts for every agent call. Application state is driven
 * exclusively by these validated objects, never by free-form model prose.
 */

const nonEmpty = z.string().trim().min(1);

export const ResearchTaskSchema = z.object({
  title: nonEmpty.max(160).describe("Short imperative title, e.g. 'Identify competitor studios'"),
  description: nonEmpty.max(1200).describe("Exactly what the researcher should find out and why"),
});
export type ResearchTask = z.infer<typeof ResearchTaskSchema>;

// ---------------------------------------------------------------- Manager

export const MANAGER_ACTIONS = ["ASSIGN_RESEARCH", "REQUEST_REVIEW", "COMPLETE", "FAIL"] as const;
export type ManagerAction = (typeof MANAGER_ACTIONS)[number];

export const ManagerDecisionSchema = z
  .object({
    action: z.enum(MANAGER_ACTIONS),
    reason: nonEmpty.describe("Why this is the right next step, grounded in the workspace"),
    message: nonEmpty.describe("What you say to the team. Address the agent you are delegating to."),
    tasks: z
      .array(ResearchTaskSchema)
      .max(4)
      .describe("Research tasks to assign. Required (1-4) for ASSIGN_RESEARCH, otherwise []"),
    reviewFocus: z
      .string()
      .nullable()
      .optional()
      .describe("For REQUEST_REVIEW: what the critic should scrutinise"),
  })
  .superRefine((value, ctx) => {
    if (value.action === "ASSIGN_RESEARCH" && value.tasks.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["tasks"],
        message: "ASSIGN_RESEARCH requires at least one task",
      });
    }
  });
export type ManagerDecision = z.infer<typeof ManagerDecisionSchema>;

export const FinalSynthesisSchema = z.object({
  summary: nonEmpty.describe("3-5 sentence executive summary answering the objective"),
  keyFindings: z
    .array(
      z.object({
        title: nonEmpty,
        detail: nonEmpty,
        sourceIds: z.array(z.string()).describe("Source ids (e.g. S1) backing this finding"),
      }),
    )
    .min(1),
  uncertainties: z.array(nonEmpty),
  recommendations: z.array(nonEmpty),
  conclusion: nonEmpty,
  confidence: z.enum(["high", "medium", "low"]),
});
export type FinalSynthesis = z.infer<typeof FinalSynthesisSchema>;

// ---------------------------------------------------------------- Researcher

export const ResearchQueriesSchema = z.object({
  queries: z.array(nonEmpty.max(200)).min(1).max(3),
  rationale: nonEmpty,
});
export type ResearchQueries = z.infer<typeof ResearchQueriesSchema>;

export const ResearchReportSchema = z
  .object({
    status: z.enum(["COMPLETED", "BLOCKED"]),
    summary: nonEmpty.describe("One paragraph for the manager"),
    findings: z.array(
      z.object({
        title: nonEmpty.max(200),
        content: nonEmpty,
        confidence: z.enum(["high", "medium", "low"]),
        sourceIds: z
          .array(z.string())
          .describe("Ids of the search results (e.g. S2) that support this finding"),
      }),
    ),
    uncertainties: z.array(nonEmpty).describe("What you could not establish with confidence"),
    blockedReason: z.string().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.status === "COMPLETED" && value.findings.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["findings"],
        message: "COMPLETED reports need at least one finding; use BLOCKED otherwise",
      });
    }
    if (value.status === "BLOCKED" && !value.blockedReason) {
      ctx.addIssue({ code: "custom", path: ["blockedReason"], message: "BLOCKED requires blockedReason" });
    }
  });
export type ResearchReport = z.infer<typeof ResearchReportSchema>;

// ---------------------------------------------------------------- Critic

export const CRITIC_ISSUE_TYPES = [
  "UNSUPPORTED_ASSUMPTION",
  "MISSING_INFORMATION",
  "CONTRADICTION",
  "WEAK_EVIDENCE",
] as const;

export const CriticReviewSchema = z
  .object({
    decision: z.enum(["APPROVED", "NEEDS_MORE_WORK"]),
    summary: nonEmpty.describe("Your overall assessment, addressed to the manager"),
    issues: z.array(
      z.object({
        type: z.enum(CRITIC_ISSUE_TYPES),
        description: nonEmpty,
        severity: z.enum(["high", "medium", "low"]),
      }),
    ),
    requestedResearch: z
      .array(ResearchTaskSchema)
      .max(3)
      .describe("Concrete follow-up research. Required when NEEDS_MORE_WORK, empty when APPROVED"),
  })
  .superRefine((value, ctx) => {
    if (value.decision === "NEEDS_MORE_WORK" && value.requestedResearch.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["requestedResearch"],
        message: "NEEDS_MORE_WORK must say what research is missing",
      });
    }
  });
export type CriticReview = z.infer<typeof CriticReviewSchema>;

// ---------------------------------------------------------------- Messages

/** Validation for agent-to-agent messages before they are persisted. */
export const AgentMessageSchema = z.object({
  taskId: nonEmpty,
  fromAgent: z.enum(["manager", "researcher", "critic", "system", "user"]),
  toAgent: z.enum(["manager", "researcher", "critic", "system", "user", "team"]),
  type: z.enum([
    "OBJECTIVE",
    "PLAN",
    "ASSIGNMENT",
    "RESEARCH_RESULT",
    "BLOCKED",
    "REVIEW_REQUEST",
    "APPROVED",
    "NEEDS_MORE_WORK",
    "DECISION",
    "REJECTED_ACTION",
    "AGENT_FAILED",
    "FINAL_RESULT",
  ]),
  content: nonEmpty.max(8000),
  reason: z.string().max(4000).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type AgentMessageInput = z.infer<typeof AgentMessageSchema>;
