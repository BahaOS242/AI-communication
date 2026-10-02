import { describe, expect, it } from "vitest";
import { MockSearchTool } from "@/lib/tools/mock-search";
import { createSearchTool } from "@/lib/tools/search";
import { redact } from "@/lib/observability/logger";
import { loadEnv } from "@/lib/config";
import { createProvider } from "@/lib/ai/provider";

describe("mock search tool", () => {
  const tool = new MockSearchTool();

  it("is deterministic and clearly labelled as demo data", async () => {
    const a = await tool.search("pilates nassau competitor studios");
    const b = await tool.search("pilates nassau competitor studios");
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
    for (const hit of a) {
      expect(hit.title).toMatch(/^\[Demo data\]/);
      expect(hit.url).toBeNull();
      expect(hit.source).toMatch(/demo dataset/i);
    }
  });

  it("returns an honest placeholder for topics outside the dataset", async () => {
    const hits = await tool.search("coffee shop competitors in Austin");
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toMatch(/No curated demo data/);
  });
});

describe("configuration", () => {
  it("uses the mock search tool when no key is configured", () => {
    expect(createSearchTool({}).isMock).toBe(true);
    expect(createSearchTool({ TAVILY_API_KEY: "k" }).name).toBe("tavily");
    expect(createSearchTool({ DEMO_MODE: true, TAVILY_API_KEY: "k" }).isMock).toBe(true);
  });

  it("selects providers from env and fails clearly when unconfigured", () => {
    expect(createProvider(loadEnv({ DEMO_MODE: "true" })).name).toBe("demo");
    expect(createProvider(loadEnv({ ANTHROPIC_API_KEY: "x" })).name).toBe("anthropic");
    expect(createProvider(loadEnv({ AI_PROVIDER: "openai", OPENAI_API_KEY: "x" })).name).toBe("openai");
    expect(() => createProvider(loadEnv({}))).toThrow(/No AI provider configured/);
    expect(() => createProvider(loadEnv({ AI_PROVIDER: "anthropic" }))).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("treats empty env values as unset and applies defaults", () => {
    const env = loadEnv({ MAX_ITERATIONS: "", ANTHROPIC_API_KEY: "" });
    expect(env.MAX_ITERATIONS).toBe(10);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });
});

describe("log redaction", () => {
  it("redacts secret keys and secret-looking values", () => {
    const out = redact({ apiKey: "abc", nested: { authorization: "Bearer xyz" }, note: "key sk-ant-1234567890abc used", inputTokens: 5 }) as Record<string, unknown>;
    expect(out.apiKey).toBe("[REDACTED]");
    expect((out.nested as Record<string, unknown>).authorization).toBe("[REDACTED]");
    expect(out.note).toBe("key [REDACTED] used");
    expect(out.inputTokens).toBe(5);
  });
});
