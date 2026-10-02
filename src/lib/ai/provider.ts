import type { AppEnv } from "../config";
import { AnthropicProvider } from "./providers/anthropic";
import { DemoProvider } from "./providers/demo";
import { OpenAIProvider } from "./providers/openai";
import type { AIProvider } from "./types";

export type { AIProvider, AIRequest, AIResponse } from "./types";

/**
 * Select the AI provider from configuration. Adding Google (or any other vendor)
 * means implementing `AIProvider` and adding a case here — nothing else changes.
 */
export function createProvider(env: AppEnv): AIProvider {
  if (env.DEMO_MODE || env.AI_PROVIDER === "demo") return new DemoProvider();

  const provider = env.AI_PROVIDER ?? (env.ANTHROPIC_API_KEY ? "anthropic" : env.OPENAI_API_KEY ? "openai" : undefined);
  switch (provider) {
    case "anthropic":
      if (!env.ANTHROPIC_API_KEY) throw new Error("AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set");
      return new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL, effort: env.ANTHROPIC_EFFORT });
    case "openai":
      if (!env.OPENAI_API_KEY) throw new Error("AI_PROVIDER=openai but OPENAI_API_KEY is not set");
      return new OpenAIProvider({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL });
    default:
      throw new Error("No AI provider configured. Set DEMO_MODE=true, or provide ANTHROPIC_API_KEY / OPENAI_API_KEY.");
  }
}
