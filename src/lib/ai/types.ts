import type { z } from "zod";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AIRequest<T = unknown> {
  /** Which agent is calling. Used for logging and by the demo provider. */
  agent: string;
  /** What the call is for, e.g. "decide", "plan_queries", "report", "review", "synthesize". */
  purpose: string;
  system: string;
  prompt: string;
  /** The schema the response must satisfy. Providers may use it for native structured output. */
  schema: z.ZodType<T>;
  schemaName: string;
  maxTokens?: number;
  signal?: AbortSignal;
  /**
   * Structured view of the same context the prompt was rendered from. Real providers
   * ignore it; the deterministic demo provider uses it instead of parsing prose.
   */
  context?: unknown;
}

export interface AIResponse {
  text: string;
  usage: TokenUsage;
  model: string;
}

/**
 * Provider abstraction. Each implementation turns a request into raw text;
 * JSON extraction, schema validation and retries are handled centrally in
 * `structured.ts` so behaviour is identical across providers.
 */
export interface AIProvider {
  readonly name: string;
  readonly model: string;
  complete(request: AIRequest): Promise<AIResponse>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
