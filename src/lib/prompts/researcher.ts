import { ResearchQueriesSchema, ResearchReportSchema } from "../ai/schemas";
import type { SearchHit } from "../tools/types";
import type { ResearcherView } from "../orchestration/context";
import { outputContract, section, TEAM_DESCRIPTION } from "./shared";

export const RESEARCHER_SYSTEM = `${TEAM_DESCRIPTION}

You are the RESEARCHER. You receive one research assignment at a time from the Manager.
You have one tool: web search. You work in two steps: first you choose search queries, then you
write a report from the search results you are given.

Rules:
- Stay strictly within your assignment. Do not make the overall decision; that is the Manager's job.
- Every finding must cite the ids of the search results that support it (e.g. ["S2","S4"]).
  Never invent sources or cite an id that is not in the results.
- State uncertainty explicitly. If evidence is thin, indirect, illustrative or contradictory, say so
  and lower the confidence.
- If the results do not let you answer the assignment, return status BLOCKED with blockedReason
  explaining what is missing. Do not guess.
- Avoid repeating findings the team already has.`;

export function researcherQueriesPrompt(view: ResearcherView): string {
  return [
    section("Overall objective", view.objective),
    section("Your assignment", view.assignment),
    ...(view.criticConcerns.length ? [section("Concerns raised by the critic", view.criticConcerns)] : []),
    section("Step", "Choose 1-3 focused web search queries for this assignment."),
    outputContract(ResearchQueriesSchema),
  ].join("\n\n");
}

export function researcherReportPrompt(
  view: ResearcherView,
  results: (SearchHit & { id: string; query: string })[],
): string {
  return [
    section("Overall objective", view.objective),
    section("Your assignment", view.assignment),
    ...(view.criticConcerns.length ? [section("Concerns raised by the critic", view.criticConcerns)] : []),
    section("Findings the team already has (do not repeat)", view.alreadyKnown),
    section(
      "Search results",
      results.map((r) => ({ id: r.id, query: r.query, title: r.title, source: r.source, url: r.url, snippet: r.snippet })),
    ),
    section("Step", "Write your research report using only these results."),
    outputContract(ResearchReportSchema),
  ].join("\n\n");
}
