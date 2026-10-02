/**
 * Client-safe, JSON-serialisable view of a task workspace. Shared between the
 * API (producer) and React components (consumer). No server imports allowed here.
 */
import type {
  AgentName,
  AgentRunRecord,
  DecisionRecord,
  FindingRecord,
  MessageRecord,
  SubtaskRecord,
  TaskEventRecord,
  TaskRecord,
} from "./domain";

type Jsonify<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Jsonify<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonify<T[K]> }
      : T;

export type AgentState = "idle" | "working" | "done" | "failed";

export interface AgentStatus {
  agent: AgentName;
  state: AgentState;
  activity: string;
  runs: number;
}

export interface TaskSnapshot {
  task: Jsonify<TaskRecord>;
  subtasks: Jsonify<SubtaskRecord>[];
  findings: Jsonify<FindingRecord>[];
  messages: Jsonify<MessageRecord>[];
  decisions: Jsonify<DecisionRecord>[];
  events: Jsonify<TaskEventRecord>[];
  agentRuns: Jsonify<AgentRunRecord>[];
  agents: AgentStatus[];
}
