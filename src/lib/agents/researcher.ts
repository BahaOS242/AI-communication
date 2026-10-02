import { generateStructured, StructuredOutputError } from "../ai/structured";
import { ResearchQueriesSchema, ResearchReportSchema, type ResearchReport } from "../ai/schemas";
import type { ResearcherView } from "../orchestration/context";
import { RESEARCHER_SYSTEM, researcherQueriesPrompt, researcherReportPrompt } from "../prompts/researcher";
import type { SearchHit } from "../tools/types";
import { Usage, type AgentDeps, type AgentResult } from "./types";

export type SourcedHit = SearchHit & { id: string; query: string; isMock: boolean };

export interface ResearchOutcome {
  queries: string[];
  report: ResearchReport;
  /** Search results that were shown to the model; findings may only cite these. */
  sources: SourcedHit[];
  /** Source ids the model cited that did not exist (hallucinated) and were removed. */
  droppedSourceIds: string[];
}

export class AgentRunError extends Error {
  constructor(
    message: string,
    readonly usage: Usage,
  ) {
    super(message);
    this.name = "AgentRunError";
  }
}

/**
 * Researcher: plan queries -> call the search tool -> write a sourced report.
 * Source ids are assigned by the engine (`firstSourceNumber`) so they stay unique per task.
 */
export async function runResearcher(
  deps: AgentDeps,
  view: ResearcherView,
  firstSourceNumber: number,
): Promise<AgentResult<ResearchOutcome>> {
  const usage = new Usage();
  const opts = (purpose: string) => ({
    maxRetries: deps.maxRetries,
    timeoutMs: deps.timeoutMs,
    onRetry: (i: { attempt: number; error: string }) => deps.onRetry?.({ purpose, ...i }),
  });

  try {
    // Step 1: decide what to search for.
    const planned = await generateStructured(
      deps.provider,
      {
        agent: "researcher",
        purpose: "plan_queries",
        system: RESEARCHER_SYSTEM,
        prompt: researcherQueriesPrompt(view),
        schema: ResearchQueriesSchema,
        schemaName: "ResearchQueries",
        maxTokens: 2000,
        signal: deps.signal,
        context: view,
      },
      opts("plan_queries"),
    );
    usage.add(planned);
    const queries = planned.data.queries;

    // Step 2: tool use.
    const sources: SourcedHit[] = [];
    const seen = new Set<string>();
    let n = firstSourceNumber;
    for (const query of queries) {
      const started = Date.now();
      try {
        const hits = await deps.search.search(query, { maxResults: 4, signal: deps.signal });
        deps.onToolCall?.({ tool: deps.search.name, input: query, resultCount: hits.length, durationMs: Date.now() - started });
        for (const hit of hits) {
          const key = hit.url ?? hit.title;
          if (seen.has(key)) continue;
          seen.add(key);
          sources.push({ ...hit, id: `S${n++}`, query, isMock: deps.search.isMock });
        }
      } catch (error) {
        deps.onToolCall?.({
          tool: deps.search.name,
          input: query,
          resultCount: 0,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - started,
        });
      }
    }

    if (sources.length === 0) {
      return {
        output: {
          queries,
          sources,
          droppedSourceIds: [],
          report: {
            status: "BLOCKED",
            summary: "The search tool returned no results for any query, so I cannot answer this assignment.",
            findings: [],
            uncertainties: [`No evidence found for: ${view.assignment.title}`],
            blockedReason: "Search returned no results",
          },
        },
        usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
        costUsd: usage.costUsd,
        attempts: usage.attempts,
        model: planned.model,
      };
    }

    // Step 3: write the report from the evidence.
    const reported = await generateStructured(
      deps.provider,
      {
        agent: "researcher",
        purpose: "report",
        system: RESEARCHER_SYSTEM,
        prompt: researcherReportPrompt(view, sources),
        schema: ResearchReportSchema,
        schemaName: "ResearchReport",
        maxTokens: 8000,
        signal: deps.signal,
        context: { ...view, results: sources },
      },
      opts("report"),
    );
    usage.add(reported);

    // Grounding guard: strip citations to sources that were never retrieved.
    const valid = new Set(sources.map((s) => s.id));
    const dropped: string[] = [];
    const findings = reported.data.findings.map((f) => {
      const kept = f.sourceIds.filter((id) => valid.has(id));
      dropped.push(...f.sourceIds.filter((id) => !valid.has(id)));
      return { ...f, sourceIds: kept, confidence: kept.length === 0 ? ("low" as const) : f.confidence };
    });

    return {
      output: { queries, sources, droppedSourceIds: dropped, report: { ...reported.data, findings } },
      usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
      costUsd: usage.costUsd,
      attempts: usage.attempts,
      model: reported.model,
    };
  } catch (error) {
    if (error instanceof StructuredOutputError) {
      usage.add({ usage: error.usage, costUsd: error.costUsd, attempts: error.attempts });
    }
    throw new AgentRunError(error instanceof Error ? error.message : String(error), usage);
  }
}
