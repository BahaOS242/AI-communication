import { ProviderError, type AIProvider, type AIRequest, type AIResponse } from "@/lib/ai/types";

export type ScriptStep = ((req: AIRequest) => unknown) | Error | string | object;

/**
 * Test double for AIProvider. Responses are scripted per "agent/purpose" key and
 * consumed in order; the final step repeats. Objects are JSON-encoded, strings
 * are returned verbatim (useful for malformed output), Errors are thrown.
 */
export class ScriptedProvider implements AIProvider {
  readonly name = "scripted";
  readonly model = "scripted-model";
  readonly calls: AIRequest[] = [];
  private readonly cursors = new Map<string, number>();

  constructor(
    private readonly script: Record<string, ScriptStep[]>,
    private readonly fallback?: AIProvider,
  ) {}

  async complete(request: AIRequest): Promise<AIResponse> {
    this.calls.push(request);
    const key = `${request.agent}/${request.purpose}`;
    const steps = this.script[key];
    if (!steps || steps.length === 0) {
      if (this.fallback) return this.fallback.complete(request);
      throw new ProviderError(`No script for ${key}`, false);
    }
    const i = this.cursors.get(key) ?? 0;
    this.cursors.set(key, i + 1);
    const scripted = steps[Math.min(i, steps.length - 1)];
    const step: unknown = typeof scripted === "function" ? scripted(request) : scripted;
    if (step instanceof Error) throw step;
    const text = typeof step === "string" ? step : JSON.stringify(step);
    return { text, model: this.model, usage: { inputTokens: 100, outputTokens: 50 } };
  }

  count(key: string) {
    return this.calls.filter((c) => `${c.agent}/${c.purpose}` === key).length;
  }
}
