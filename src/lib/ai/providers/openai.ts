import { ProviderError, type AIProvider, type AIRequest, type AIResponse } from "../types";

export interface OpenAIProviderOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

/**
 * OpenAI Chat Completions provider (JSON mode). Included to demonstrate that the
 * orchestration layer is provider-agnostic; uses fetch to avoid an extra dependency.
 */
export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: OpenAIProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? "gpt-4.1";
    this.baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
  }

  async complete(request: AIRequest): Promise<AIResponse> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        signal: request.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          max_tokens: request.maxTokens ?? 8000,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.prompt },
          ],
        }),
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      throw new ProviderError(aborted ? "Request aborted" : `Network error: ${(error as Error).message}`, !aborted);
    }
    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      throw new ProviderError(`OpenAI API error ${res.status}`, retryable, res.status);
    }
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = body.choices?.[0]?.message?.content ?? "";
    if (!text) throw new ProviderError("OpenAI returned empty content", true);
    return {
      text,
      model: this.model,
      usage: {
        inputTokens: body.usage?.prompt_tokens ?? 0,
        outputTokens: body.usage?.completion_tokens ?? 0,
      },
    };
  }
}
