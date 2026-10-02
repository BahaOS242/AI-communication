import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ProviderError, type AIProvider, type AIRequest, type AIResponse } from "../types";

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Use native structured outputs (`output_config.format`). Falls back automatically if rejected. */
  structuredOutputs?: boolean;
}

/**
 * Anthropic Claude provider using the official SDK.
 * The SDK's own retries are disabled; retry policy lives in `structured.ts`.
 */
export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  readonly model: string;
  private readonly client: Anthropic;
  private readonly effort: AnthropicProviderOptions["effort"];
  private structuredOutputs: boolean;

  constructor(options: AnthropicProviderOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey, maxRetries: 0 });
    this.model = options.model ?? "claude-opus-5-5";
    this.effort = options.effort ?? "medium";
    this.structuredOutputs = options.structuredOutputs ?? true;
  }

  async complete(request: AIRequest): Promise<AIResponse> {
    try {
      return await this.send(request, this.structuredOutputs);
    } catch (error) {
      // Some schemas use constructs native structured outputs can't express.
      // Validation is enforced centrally anyway, so degrade to prompt-only JSON.
      if (this.structuredOutputs && error instanceof Anthropic.BadRequestError) {
        this.structuredOutputs = false;
        return this.send(request, false).catch((e) => {
          throw toProviderError(e);
        });
      }
      throw toProviderError(error);
    }
  }

  private async send(request: AIRequest, structured: boolean): Promise<AIResponse> {
    const response = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: request.maxTokens ?? 16000,
        system: request.system,
        messages: [{ role: "user", content: request.prompt }],
        output_config: {
          effort: this.effort,
          ...(structured ? { format: zodOutputFormat(request.schema) } : {}),
        },
      },
      { signal: request.signal },
    );

    if (response.stop_reason === "refusal") {
      throw new ProviderError("Model declined the request (stop_reason=refusal)", false);
    }
    const text = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();
    if (!text) throw new ProviderError("Model returned no text content", true);

    return {
      text,
      model: this.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}

function toProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof Anthropic.APIError) {
    const status = error.status;
    const retryable = status === undefined || status === 408 || status === 409 || status === 429 || status >= 500;
    return new ProviderError(`Anthropic API error ${status ?? ""}: ${error.message}`, retryable, status);
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new ProviderError("Request aborted", false);
  }
  return new ProviderError(error instanceof Error ? error.message : String(error), true);
}
