import type {
  AgentName,
  AgentRunStatus,
  Confidence,
  EventType,
  FinalResult,
  MessageType,
  Participant,
  Recipient,
  SubtaskRecord,
  SubtaskStatus,
  TaskEventRecord,
  TaskRecord,
  TaskStatus,
  Workspace,
} from "../domain";

export interface CreateTaskInput {
  objective: string;
  provider: string;
  searchTool: string;
  demoMode: boolean;
  userEmail?: string;
}

export type TaskPatch = Partial<
  Pick<
    TaskRecord,
    | "status"
    | "currentStep"
    | "iteration"
    | "agentCalls"
    | "inputTokens"
    | "outputTokens"
    | "estimatedCostUsd"
    | "finalResult"
    | "error"
    | "startedAt"
    | "completedAt"
  >
>;

export interface NewSubtask {
  title: string;
  description: string;
  assignedTo: AgentName;
  origin: AgentName;
  iteration: number;
}

export interface NewFinding {
  subtaskId: string | null;
  agentRunId: string | null;
  kind: "FINDING" | "UNCERTAINTY";
  title: string;
  content: string;
  confidence: Confidence;
  iteration: number;
  evidence: { sourceId: string; title: string; url: string | null; snippet: string; tool: string; isMock: boolean }[];
}

export interface NewMessage {
  fromAgent: Participant;
  toAgent: Recipient;
  type: MessageType;
  content: string;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface NewEvent {
  type: EventType;
  agent?: Participant | null;
  message: string;
  data?: Record<string, unknown> | null;
}

export interface AgentRunStart {
  agent: AgentName;
  purpose: string;
  iteration: number;
  input: unknown;
}

export interface AgentRunFinish {
  status: AgentRunStatus;
  output?: unknown;
  error?: string | null;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  model?: string | null;
  durationMs: number;
}

export interface TaskSummary {
  id: string;
  objective: string;
  status: TaskStatus;
  createdAt: Date;
}

/**
 * Persistence port for the orchestration engine. The engine only talks to this
 * interface, so it can be tested in memory and backed by Postgres in production.
 */
export interface TaskRepository {
  createTask(input: CreateTaskInput): Promise<TaskRecord>;
  getWorkspace(taskId: string): Promise<Workspace | null>;
  listTasks(limit: number): Promise<TaskSummary[]>;
  updateTask(taskId: string, patch: TaskPatch): Promise<void>;
  createSubtasks(taskId: string, subtasks: NewSubtask[]): Promise<SubtaskRecord[]>;
  updateSubtask(subtaskId: string, patch: { status: SubtaskStatus; completedAt?: Date | null }): Promise<void>;
  createFindings(taskId: string, findings: NewFinding[]): Promise<void>;
  addMessage(taskId: string, message: NewMessage): Promise<void>;
  addDecision(
    taskId: string,
    decision: { agent: AgentName; action: string; reason: string; accepted: boolean; iteration: number },
  ): Promise<void>;
  addEvent(taskId: string, event: NewEvent): Promise<TaskEventRecord>;
  startAgentRun(taskId: string, run: AgentRunStart): Promise<string>;
  finishAgentRun(runId: string, result: AgentRunFinish): Promise<void>;
}

export type { FinalResult };
