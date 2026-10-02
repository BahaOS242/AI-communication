import { z } from "zod";
import { extractJson } from "./json";
import { estimateCostUsd } from "./pricing";
import { ProviderError, type AIProvider, type AIRequest, type TokenUsage } from "./types";

export interface StructuredOptions {
  /** Additional attempts after the first one. */
  maxRetries: number;
  timeoutMs: number;
  onRetry?: (info: { attempt: number; error: string }) => void;
}

export interface StructuredResult<T> {
  data: T;
  attempts: number;
  usage: TokenUsage;
  costUsd: number;
  model: string;
}

export class StructuredOutputError extends Error {
  constructor(
    message: string,
    readonly attempts: number,
    readonly usage: TokenUsage,
    readonly costUsd: number,
    readonly lastRawText?: string,
  ) {
    super(message);
    this.name = "StructuredOutputError";
  }
}

export class TimeoutError extends ProviderError {
  constructor(ms: number) {
    super(`LLM call timed out after ${ms}ms`, true);
    this.name = "TimeoutError";
  }
}

async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number,
  parent?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(parent?.reason);
  parent?.addEventListener("abort", onAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new TimeoutError(ms));
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", onAbort);
  }
}

export function formatZodError(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((i) => `${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`)
    .join("; ");
}

/**
 * Call a provider and return schema-validated data.
 *
 * - Malformed JSON or schema violations are retried with the validation error fed
 *   back to the model, up to `maxRetries` extra attempts.
 * - Retryable provider errors (timeouts, 429, 5xx) are retried with backoff.
 * - Non-retryable provider errors fail immediately.
 * Token usage is accumulated across every attempt so cost tracking is honest.
 */
export async function generateStructured<T>(
  provider: AIProvider,
  request: AIRequest<T>,
  options: StructuredOptions,
): Promise<StructuredResult<T>> {
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let costUsd = 0;
  let prompt = request.prompt;
  let lastError = "unknown error";
  let lastRaw: string | undefined;
  const totalAttempts = options.maxRetries + 1;
  let attemptsMade = 0;

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    attemptsMade = attempt;
    try {
      const response = await withTimeout(
        (signal) => provider.complete({ ...request, prompt, signal }),
        options.timeoutMs,
        request.signal,
      );
      usage.inputTokens += response.usage.inputTokens;
      usage.outputTokens += response.usage.outputTokens;
      costUsd += estimateCostUsd(response.model, response.usage);
      lastRaw = response.text;

      let json: unknown;
      try {
        json = extractJson(response.text);
      } catch (e) {
        throw new ValidationFailure(`Invalid JSON: ${(e as Error).message}`);
      }
      const parsed = request.schema.safeParse(json);
      if (!parsed.success) {
        throw new ValidationFailure(`Schema validation failed: ${formatZodError(parsed.error)}`);
      }
      return { data: parsed.data, attempts: attempt, usage, costUsd, model: response.model };
    } catch (error) {
      if (error instanceof ValidationFailure) {
        lastError = error.message;
        prompt =
          `${request.prompt}\n\n---\nYour previous response was rejected. ${error.message}\n` +
          `Respond again with ONLY a JSON object that matches the required schema exactly.`;
      } else if (error instanceof ProviderError) {
        lastError = error.message;
        if (!error.retryable) break;
        await sleep(Math.min(250 * 2 ** (attempt - 1), 4000));
      } else {
        lastError = error instanceof Error ? error.message : String(error);
        break;
      }
      if (attempt < totalAttempts) options.onRetry?.({ attempt, error: lastError });
    }
  }

  throw new StructuredOutputError(
    `${request.agent}/${request.purpose} failed: ${lastError}`,
    attemptsMade,
    usage,
    costUsd,
    lastRaw,
  );
}

class ValidationFailure extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
