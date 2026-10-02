import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { extractJson } from "@/lib/ai/json";
import { generateStructured, StructuredOutputError } from "@/lib/ai/structured";
import { ProviderError, type AIProvider, type AIRequest } from "@/lib/ai/types";

const Schema = z.object({ answer: z.number() });

function provider(responses: (string | Error)[]): AIProvider & { calls: AIRequest[] } {
  const calls: AIRequest[] = [];
  let i = 0;
  return {
    name: "test",
    model: "claude-opus-5-5",
    calls,
    async complete(req) {
      calls.push(req);
      const r = responses[Math.min(i++, responses.length - 1)];
      if (r instanceof Error) throw r;
      return { text: r, model: "claude-opus-5-5", usage: { inputTokens: 1000, outputTokens: 100 } };
    },
  };
}

const request = { agent: "manager", purpose: "decide", system: "s", prompt: "p", schema: Schema, schemaName: "S" };

describe("extractJson", () => {
  it("parses bare, fenced and prefixed JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"a":1} hope that helps')).toEqual({ a: 1 });
  });
  it("throws when there is no JSON", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("generateStructured", () => {
  it("returns validated data on the first attempt", async () => {
    const p = provider(['{"answer":42}']);
    const r = await generateStructured(p, request, { maxRetries: 2, timeoutMs: 1000 });
    expect(r.data).toEqual({ answer: 42 });
    expect(r.attempts).toBe(1);
    // claude-opus-5-5: $4 in / $20 out per MTok
    expect(r.costUsd).toBeCloseTo((1000 * 4 + 100 * 20) / 1_000_000);
  });

  it("retries malformed output with feedback, accumulating usage", async () => {
    const p = provider(["nope", '{"answer":"forty-two"}', '{"answer":42}']);
    const onRetry = vi.fn();
    const r = await generateStructured(p, request, { maxRetries: 2, timeoutMs: 1000, onRetry });
    expect(r.attempts).toBe(3);
    expect(r.usage.inputTokens).toBe(3000);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(p.calls[1].prompt).toMatch(/Invalid JSON/);
    expect(p.calls[2].prompt).toMatch(/answer/);
  });

  it("gives up after the retry limit", async () => {
    const p = provider(["nope"]);
    const err = await generateStructured(p, request, { maxRetries: 1, timeoutMs: 1000 }).catch((e) => e);
    expect(err).toBeInstanceOf(StructuredOutputError);
    expect(err.attempts).toBe(2);
    expect(err.usage.inputTokens).toBe(2000);
    expect(err.lastRawText).toBe("nope");
  });

  it("does not retry non-retryable provider errors", async () => {
    const p = provider([new ProviderError("bad request", false, 400)]);
    const err = await generateStructured(p, request, { maxRetries: 3, timeoutMs: 1000 }).catch((e) => e);
    expect(err).toBeInstanceOf(StructuredOutputError);
    expect(err.attempts).toBe(1);
    expect(p.calls).toHaveLength(1);
  });

  it("retries retryable provider errors", async () => {
    const p = provider([new ProviderError("overloaded", true, 529), '{"answer":1}']);
    const r = await generateStructured(p, request, { maxRetries: 1, timeoutMs: 1000 });
    expect(r.data.answer).toBe(1);
    expect(r.attempts).toBe(2);
  });

  it("times out hung calls", async () => {
    const hung: AIProvider = { name: "h", model: "m", complete: () => new Promise(() => {}) };
    const err = await generateStructured(hung, request, { maxRetries: 0, timeoutMs: 20 }).catch((e) => e);
    expect(err).toBeInstanceOf(StructuredOutputError);
    expect(err.message).toMatch(/timed out/);
  });
});
