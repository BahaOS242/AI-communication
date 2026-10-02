import type { AIProvider, TokenUsage } from "../ai/types";
import type { SearchTool } from "../tools/types";

/** Dependencies injected into every agent. Agents never touch the database. */
export interface AgentDeps {
  provider: AIProvider;
  search: SearchTool;
  maxRetries: number;
  timeoutMs: number;
  signal?: AbortSignal;
  onRetry?: (info: { purpose: string; attempt: number; error: string }) => void;
  onToolCall?: (info: ToolCallRecord) => void;
}

export interface ToolCallRecord {
  tool: string;
  input: string;
  resultCount: number;
  error?: string;
  durationMs: number;
}

export interface AgentResult<T> {
  output: T;
  usage: TokenUsage;
  costUsd: number;
  attempts: number;
  model: string;
}

export class Usage {
  inputTokens = 0;
  outputTokens = 0;
  costUsd = 0;
  attempts = 0;
  add(r: { usage: TokenUsage; costUsd: number; attempts: number }) {
    this.inputTokens += r.usage.inputTokens;
    this.outputTokens += r.usage.outputTokens;
    this.costUsd += r.costUsd;
    this.attempts += r.attempts;
  }
}
