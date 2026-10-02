/**
 * Tool abstraction. Agents depend on these interfaces, never on a concrete API,
 * so new tools (browser, code execution, MCP servers, ...) can be added later
 * without touching orchestration code.
 */
export interface SearchHit {
  title: string;
  url: string | null;
  snippet: string;
  /** Publisher / domain, or "AgentForge demo dataset" for mock data. */
  source: string;
}

export interface SearchOptions {
  maxResults?: number;
  signal?: AbortSignal;
}

export interface SearchTool {
  readonly name: string;
  /** True when results do not come from the live web. Surfaced in the UI. */
  readonly isMock: boolean;
  search(query: string, options?: SearchOptions): Promise<SearchHit[]>;
}

export class ToolError extends Error {
  constructor(
    message: string,
    readonly tool: string,
  ) {
    super(message);
    this.name = "ToolError";
  }
}
