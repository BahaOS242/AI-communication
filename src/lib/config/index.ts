import { z } from "zod";

/**
 * Runtime configuration, validated once from environment variables.
 * Server-only: never import this from client components.
 */
const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const int = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? fallback : Number.parseInt(v, 10)))
    .pipe(z.number().int().nonnegative());

const EnvSchema = z.object({
  DEMO_MODE: bool,
  DEMO_STEP_DELAY_MS: int(900),
  AI_PROVIDER: z.enum(["anthropic", "openai", "demo"]).optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().optional(),
  ANTHROPIC_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
  TAVILY_API_KEY: z.string().optional(),
  BRAVE_SEARCH_API_KEY: z.string().optional(),
  MAX_ITERATIONS: int(10),
  MAX_AGENT_CALLS: int(30),
  MAX_RETRIES: int(2),
  AGENT_TIMEOUT_MS: int(120_000),
  TASK_TIMEOUT_MS: int(900_000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional(),
});

export type AppEnv = z.infer<typeof EnvSchema>;

/** Limits that protect the orchestration loop from runaway behaviour. */
export interface EngineLimits {
  /** Maximum number of manager decision cycles. */
  maxIterations: number;
  /** Maximum number of agent invocations (any agent) for a single task. */
  maxAgentCalls: number;
  /** Retries per agent call for malformed output or transient provider errors. */
  maxRetries: number;
  /** Timeout for a single LLM call. */
  agentTimeoutMs: number;
  /** Wall-clock budget for the entire task. */
  taskTimeoutMs: number;
  /** Consecutive failed agent runs tolerated before the task is stopped. */
  maxConsecutiveFailures: number;
  /** Consecutive rejected manager actions tolerated before the task is stopped. */
  maxRejectedActions: number;
}

export const DEFAULT_LIMITS: EngineLimits = {
  maxIterations: 10,
  maxAgentCalls: 30,
  maxRetries: 2,
  agentTimeoutMs: 120_000,
  taskTimeoutMs: 900_000,
  maxConsecutiveFailures: 3,
  maxRejectedActions: 3,
};

function sanitize(raw: Record<string, string | undefined>): Record<string, string | undefined> {
  // Treat empty strings as unset so `.env` placeholders don't count as configured.
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v === "" ? undefined : v]));
}

export function loadEnv(raw: Record<string, string | undefined> = process.env): AppEnv {
  return EnvSchema.parse(sanitize(raw));
}

export function limitsFromEnv(env: AppEnv): EngineLimits {
  return {
    ...DEFAULT_LIMITS,
    maxIterations: env.MAX_ITERATIONS,
    maxAgentCalls: env.MAX_AGENT_CALLS,
    maxRetries: env.MAX_RETRIES,
    agentTimeoutMs: env.AGENT_TIMEOUT_MS,
    taskTimeoutMs: env.TASK_TIMEOUT_MS,
  };
}
