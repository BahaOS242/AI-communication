/**
 * Core domain types for the shared task workspace.
 *
 * These are deliberately independent from Prisma so the orchestration engine can
 * run against any repository implementation (Postgres in the app, in-memory in tests).
 */

export const TASK_STATUSES = [
  "PENDING",
  "PLANNING",
  "RESEARCHING",
  "REVIEWING",
  "NEEDS_MORE_WORK",
  "SYNTHESIZING",
  "COMPLETED",
  "FAILED",
  "FAILED_REQUIRES_REVIEW",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/**
 * Agent identifiers. New agents (browser, analyst, code runner, ...) are added
 * here and registered in `src/lib/agents/registry.ts`.
 */
export const AGENT_NAMES = ["manager", "researcher", "critic"] as const;
export type AgentName = (typeof AGENT_NAMES)[number];
/** "system" is the orchestration engine itself; "user" is the human. */
export type Participant = AgentName | "system" | "user";
/** Messages can also be broadcast to the whole team. */
export type Recipient = Participant | "team";

export const MESSAGE_TYPES = [
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
] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const EVENT_TYPES = [
  "TASK_CREATED",
  "TASK_STARTED",
  "STATUS_CHANGED",
  "MANAGER_STARTED",
  "MANAGER_PLANNED",
  "MANAGER_DECIDED",
  "MANAGER_ACTION_REJECTED",
  "MANAGER_REASSIGNED_TASK",
  "AGENT_STARTED",
  "AGENT_COMPLETED",
  "AGENT_FAILED",
  "AGENT_RETRY",
  "TOOL_CALLED",
  "MESSAGE_SENT",
  "FINDING_CREATED",
  "CRITIC_APPROVED",
  "CRITIC_REQUESTED_MORE_WORK",
  "LIMIT_REACHED",
  "TASK_COMPLETED",
  "TASK_FAILED",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type SubtaskStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "BLOCKED" | "FAILED";
export type Confidence = "high" | "medium" | "low";

export interface TaskRecord {
  id: string;
  objective: string;
  status: TaskStatus;
  currentStep: string | null;
  iteration: number;
  agentCalls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  provider: string;
  searchTool: string;
  demoMode: boolean;
  finalResult: FinalResult | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface SubtaskRecord {
  id: string;
  taskId: string;
  title: string;
  description: string;
  assignedTo: AgentName;
  origin: AgentName;
  status: SubtaskStatus;
  iteration: number;
  createdAt: Date;
  completedAt: Date | null;
}

export interface EvidenceRecord {
  id: string;
  findingId: string | null;
  sourceId: string;
  title: string;
  url: string | null;
  snippet: string;
  tool: string;
  isMock: boolean;
}

export interface FindingRecord {
  id: string;
  taskId: string;
  subtaskId: string | null;
  agentRunId: string | null;
  kind: "FINDING" | "UNCERTAINTY";
  title: string;
  content: string;
  confidence: Confidence;
  iteration: number;
  createdAt: Date;
  evidence: EvidenceRecord[];
}

export interface MessageRecord {
  id: string;
  taskId: string;
  fromAgent: Participant;
  toAgent: Recipient;
  type: MessageType;
  content: string;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface DecisionRecord {
  id: string;
  agent: AgentName;
  action: string;
  reason: string;
  accepted: boolean;
  iteration: number;
  createdAt: Date;
}

export interface TaskEventRecord {
  id: string;
  seq: number;
  type: EventType;
  agent: Participant | null;
  message: string;
  data: Record<string, unknown> | null;
  createdAt: Date;
}

export type AgentRunStatus = "RUNNING" | "COMPLETED" | "FAILED";

export interface AgentRunRecord {
  id: string;
  agent: AgentName;
  purpose: string;
  iteration: number;
  status: AgentRunStatus;
  input: unknown;
  output: unknown;
  error: string | null;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  model: string | null;
  durationMs: number | null;
  startedAt: Date;
  finishedAt: Date | null;
}

/** A critic review, reconstructed from the critic's structured message. */
export interface ReviewRecord {
  messageId: string;
  decision: "APPROVED" | "NEEDS_MORE_WORK";
  summary: string;
  reviewedFindingIds: string[];
  issues: { type: string; description: string; severity: string }[];
  requestedResearch: { title: string; description: string }[];
  createdAt: Date;
}

export interface Workspace {
  task: TaskRecord;
  subtasks: SubtaskRecord[];
  findings: FindingRecord[];
  messages: MessageRecord[];
  decisions: DecisionRecord[];
  events: TaskEventRecord[];
  agentRuns: AgentRunRecord[];
}

export interface FinalResult {
  /** "complete" = approved by the critic; "partial" = produced after a limit or failure. */
  kind: "complete" | "partial";
  summary: string;
  keyFindings: { title: string; detail: string; sourceIds: string[] }[];
  evidence: { sourceId: string; title: string; url: string | null; snippet: string; isMock: boolean }[];
  uncertainties: string[];
  recommendations: string[];
  conclusion: string;
  confidence: Confidence;
  generatedAt: string;
}
