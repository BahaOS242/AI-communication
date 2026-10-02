import { generateStructured } from "../ai/structured";
import { CriticReviewSchema, type CriticReview } from "../ai/schemas";
import type { CriticView } from "../orchestration/context";
import { CRITIC_SYSTEM, criticPrompt } from "../prompts/critic";
import type { AgentDeps, AgentResult } from "./types";

/** Critic: reviews findings and returns APPROVED or NEEDS_MORE_WORK. */
export async function criticReview(deps: AgentDeps, view: CriticView): Promise<AgentResult<CriticReview>> {
  const result = await generateStructured(
    deps.provider,
    {
      agent: "critic",
      purpose: "review",
      system: CRITIC_SYSTEM,
      prompt: criticPrompt(view),
      schema: CriticReviewSchema,
      schemaName: "CriticReview",
      maxTokens: 8000,
      signal: deps.signal,
      context: view,
    },
    {
      maxRetries: deps.maxRetries,
      timeoutMs: deps.timeoutMs,
      onRetry: (i) => deps.onRetry?.({ purpose: "review", ...i }),
    },
  );
  return { output: result.data, usage: result.usage, costUsd: result.costUsd, attempts: result.attempts, model: result.model };
}
