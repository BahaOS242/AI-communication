import type { TokenUsage } from "./types";

/** USD per million tokens. Unknown models are tracked for tokens but cost 0. */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "gpt-4.1": { input: 2, output: 8 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
};

export function estimateCostUsd(model: string, usage: TokenUsage): number {
  const price = PRICES[model];
  if (!price) return 0;
  return (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
}

/** Rough token estimate (~4 chars/token) for providers that don't report usage. */
export function approximateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
