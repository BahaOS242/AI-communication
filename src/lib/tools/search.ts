import { MockSearchTool } from "./mock-search";
import { ToolError, type SearchHit, type SearchOptions, type SearchTool } from "./types";

export type { SearchHit, SearchTool } from "./types";

/** Tavily web search (https://tavily.com). */
export class TavilySearchTool implements SearchTool {
  readonly name = "tavily";
  readonly isMock = false;
  constructor(private readonly apiKey: string) {}

  async search(query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      signal: options.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ query, max_results: options.maxResults ?? 5, search_depth: "basic" }),
    });
    if (!res.ok) throw new ToolError(`Tavily search failed with status ${res.status}`, this.name);
    const body = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] };
    return (body.results ?? []).map((r) => ({
      title: r.title ?? "Untitled",
      url: r.url ?? null,
      snippet: (r.content ?? "").slice(0, 800),
      source: hostname(r.url),
    }));
  }
}

/** Brave Search API (https://brave.com/search/api/). */
export class BraveSearchTool implements SearchTool {
  readonly name = "brave";
  readonly isMock = false;
  constructor(private readonly apiKey: string) {}

  async search(query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(options.maxResults ?? 5));
    const res = await fetch(url, {
      signal: options.signal,
      headers: { accept: "application/json", "x-subscription-token": this.apiKey },
    });
    if (!res.ok) throw new ToolError(`Brave search failed with status ${res.status}`, this.name);
    const body = (await res.json()) as {
      web?: { results?: { title?: string; url?: string; description?: string }[] };
    };
    return (body.web?.results ?? []).map((r) => ({
      title: r.title ?? "Untitled",
      url: r.url ?? null,
      snippet: stripTags(r.description ?? "").slice(0, 800),
      source: hostname(r.url),
    }));
  }
}

export function createSearchTool(env: {
  DEMO_MODE?: boolean;
  TAVILY_API_KEY?: string;
  BRAVE_SEARCH_API_KEY?: string;
}): SearchTool {
  if (env.DEMO_MODE) return new MockSearchTool();
  if (env.TAVILY_API_KEY) return new TavilySearchTool(env.TAVILY_API_KEY);
  if (env.BRAVE_SEARCH_API_KEY) return new BraveSearchTool(env.BRAVE_SEARCH_API_KEY);
  return new MockSearchTool();
}

function hostname(url?: string): string {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "") : "unknown";
  } catch {
    return "unknown";
  }
}

const stripTags = (s: string) => s.replace(/<[^>]+>/g, "");
