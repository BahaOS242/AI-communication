import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AnthropicProvider } from "@/lib/ai/providers/anthropic";
import {
  CriticReviewSchema,
  FinalSynthesisSchema,
  ManagerDecisionSchema,
  ResearchQueriesSchema,
  ResearchReportSchema,
} from "@/lib/ai/schemas";
import { generateStructured } from "@/lib/ai/structured";
import type { z } from "zod";

/**
 * Exercises the real Anthropic SDK request path against a local fake API, so the
 * wire format (headers, output_config, usage parsing, error mapping) is verified
 * without an API key.
 */
type Handler = (body: Record<string, unknown>, req: IncomingMessage) => { status: number; json: unknown };
let handler: Handler;
const received: { body: Record<string, unknown>; headers: IncomingMessage["headers"] }[] = [];
let server: Server;
let baseURL: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      received.push({ body, headers: req.headers });
      const { status, json } = handler(body, req);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const message = (text: string, stop_reason = "end_turn") => ({
  status: 200,
  json: {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [{ type: "text", text }],
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 1200, output_tokens: 300 },
  },
});

const request = <T>(schema: z.ZodType<T>) => ({
  agent: "manager",
  purpose: "decide",
  system: "sys",
  prompt: "prompt",
  schema,
  schemaName: "S",
});

describe("AnthropicProvider (fake API)", () => {
  it("sends system, model, effort and a native JSON schema for every agent schema", async () => {
    for (const schema of [ManagerDecisionSchema, ResearchQueriesSchema, ResearchReportSchema, CriticReviewSchema, FinalSynthesisSchema]) {
      received.length = 0;
      handler = () => message('{"queries":["q"],"rationale":"r"}');
      const provider = new AnthropicProvider({ apiKey: "test-key", baseURL });
      await provider.complete(request(schema as z.ZodType));
      const { body, headers } = received[0];
      expect(headers["x-api-key"]).toBe("test-key");
      expect(body.model).toBe("claude-opus-5-5");
      expect(body.system).toBe("sys");
      expect(body.messages).toEqual([{ role: "user", content: "prompt" }]);
      const config = body.output_config as { effort: string; format: { type: string; schema: { type: string } } };
      expect(config.effort).toBe("medium");
      expect(config.format.type).toBe("json_schema");
      expect(config.format.schema.type).toBe("object");
    }
  });

  it("parses text and usage, and prices tokens through generateStructured", async () => {
    handler = () => message('{"queries":["pilates nassau"],"rationale":"r"}');
    const provider = new AnthropicProvider({ apiKey: "k", baseURL });
    const result = await generateStructured(provider, request(ResearchQueriesSchema), { maxRetries: 0, timeoutMs: 5000 });
    expect(result.data.queries).toEqual(["pilates nassau"]);
    expect(result.usage).toEqual({ inputTokens: 1200, outputTokens: 300 });
    expect(result.costUsd).toBeCloseTo((1200 * 4 + 300 * 20) / 1e6);
  });

  it("falls back to prompt-only JSON when the API rejects the schema", async () => {
    received.length = 0;
    handler = (body) =>
      body.output_config && (body.output_config as Record<string, unknown>).format
        ? { status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "unsupported schema" } } }
        : message('{"queries":["q"],"rationale":"r"}');
    const provider = new AnthropicProvider({ apiKey: "k", baseURL });
    const res = await provider.complete(request(ResearchQueriesSchema));
    expect(res.text).toContain("queries");
    expect(received).toHaveLength(2);
    // Subsequent calls skip native structured outputs entirely.
    await provider.complete(request(ResearchQueriesSchema));
    expect(received).toHaveLength(3);
    expect((received[2].body.output_config as Record<string, unknown>).format).toBeUndefined();
  });

  it("maps rate limits to retryable errors and auth errors to non-retryable", async () => {
    const provider = new AnthropicProvider({ apiKey: "k", baseURL });
    handler = () => ({ status: 429, json: { type: "error", error: { type: "rate_limit_error", message: "slow down" } } });
    await expect(provider.complete(request(ResearchQueriesSchema))).rejects.toMatchObject({ retryable: true, status: 429 });
    handler = () => ({ status: 401, json: { type: "error", error: { type: "authentication_error", message: "bad key" } } });
    await expect(provider.complete(request(ResearchQueriesSchema))).rejects.toMatchObject({ retryable: false, status: 401 });
  });

  it("treats a refusal as a non-retryable failure", async () => {
    handler = () => message("", "refusal");
    const provider = new AnthropicProvider({ apiKey: "k", baseURL });
    await expect(provider.complete(request(ResearchQueriesSchema))).rejects.toMatchObject({ retryable: false });
  });
});
