import { DEFAULT_LIMITS, type EngineLimits } from "@/lib/config";
import type { AIProvider } from "@/lib/ai/types";
import { OrchestrationEngine } from "@/lib/orchestration/engine";
import { InMemoryTaskRepository } from "@/lib/orchestration/memory-repository";
import { MockSearchTool } from "@/lib/tools/mock-search";
import type { SearchTool } from "@/lib/tools/types";

export const OBJECTIVE = "Determine whether a tourist-focused Pilates package would be viable in Nassau.";

export const plan = (titles: string[]) => ({
  action: "ASSIGN_RESEARCH",
  reason: "Need evidence",
  message: "Researcher, please investigate.",
  tasks: titles.map((t) => ({ title: t, description: `Find out: ${t}` })),
});
export const requestReview = { action: "REQUEST_REVIEW", reason: "New findings", message: "Critic, please review.", tasks: [] };
export const complete = { action: "COMPLETE", reason: "Approved", message: "Done.", tasks: [] };
export const queries = { queries: ["pilates nassau competitor studios"], rationale: "focused" };
export const researchReport = (title = "Competitors exist") => ({
  status: "COMPLETED",
  summary: "Found things.",
  findings: [{ title, content: "Two studios serve residents.", confidence: "medium", sourceIds: ["S1"] }],
  uncertainties: ["Tourist share unknown"],
});
export const approved = { decision: "APPROVED", summary: "Good enough.", issues: [], requestedResearch: [] };
export const needsMoreWork = (title: string) => ({
  decision: "NEEDS_MORE_WORK",
  summary: `Missing: ${title}`,
  issues: [{ type: "MISSING_INFORMATION", description: `No evidence on ${title}`, severity: "high" }],
  requestedResearch: [{ title, description: `Investigate ${title}` }],
});
export const synthesis = {
  summary: "Viable with caveats.",
  keyFindings: [{ title: "Gap exists", detail: "Resident-focused studios.", sourceIds: ["S1", "S999"] }],
  uncertainties: ["Demo data"],
  recommendations: ["Pilot"],
  conclusion: "Proceed carefully.",
  confidence: "medium",
};

export async function setup(
  provider: AIProvider,
  limits: Partial<EngineLimits> = {},
  search: SearchTool = new MockSearchTool(),
) {
  const repo = new InMemoryTaskRepository();
  const task = await repo.createTask({ objective: OBJECTIVE, provider: provider.name, searchTool: search.name, demoMode: true });
  const engine = new OrchestrationEngine({ repo, provider, search, limits: { ...DEFAULT_LIMITS, ...limits } });
  return {
    repo,
    taskId: task.id,
    run: async () => {
      await engine.run(task.id);
      const ws = await repo.getWorkspace(task.id);
      if (!ws) throw new Error("missing workspace");
      return ws;
    },
  };
}
