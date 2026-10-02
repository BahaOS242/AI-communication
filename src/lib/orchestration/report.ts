import type { FinalSynthesis } from "../ai/schemas";
import type { FinalResult, Workspace } from "../domain";
import { uniqueSources } from "./context";
import { latestReview, outstandingCriticRequests } from "./state-machine";

function evidenceList(ws: Workspace): FinalResult["evidence"] {
  return uniqueSources(ws).map((e) => ({
    sourceId: e.sourceId,
    title: e.title,
    url: e.url,
    snippet: e.snippet,
    isMock: e.isMock,
  }));
}

/** Combine the manager's synthesis with evidence taken from the workspace (never from the model). */
export function buildFinalResult(ws: Workspace, synthesis: FinalSynthesis): FinalResult {
  const evidence = evidenceList(ws);
  const known = new Set(evidence.map((e) => e.sourceId));
  return {
    kind: "complete",
    summary: synthesis.summary,
    keyFindings: synthesis.keyFindings.map((k) => ({ ...k, sourceIds: k.sourceIds.filter((id) => known.has(id)) })),
    evidence,
    uncertainties: synthesis.uncertainties,
    recommendations: synthesis.recommendations,
    conclusion: synthesis.conclusion,
    confidence: synthesis.confidence,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Deterministic report of the work completed so far, used when a task stops early
 * (limit reached, agent failure, manager FAIL). No LLM call, so it cannot fail.
 */
export function buildPartialResult(ws: Workspace, reason: string): FinalResult {
  const findings = ws.findings.filter((f) => f.kind === "FINDING");
  const review = latestReview(ws);
  const gaps = outstandingCriticRequests(ws).map((r) => `Not yet researched: ${r.title}`);
  return {
    kind: "partial",
    summary:
      `AgentForge stopped before the team could finish: ${reason}. ` +
      `${findings.length} finding(s) were gathered across ${ws.subtasks.length} subtask(s)` +
      (review ? `; the critic's latest verdict was ${review.decision}.` : "; the findings were not reviewed by the critic.") +
      " The material below has not been fully validated and needs human review.",
    keyFindings: findings.slice(0, 10).map((f) => ({
      title: f.title,
      detail: f.content,
      sourceIds: f.evidence.map((e) => e.sourceId),
    })),
    evidence: evidenceList(ws),
    uncertainties: [
      ...gaps,
      ...(review?.issues ?? []).map((i) => `${i.type}: ${i.description}`),
      ...ws.findings.filter((f) => f.kind === "UNCERTAINTY").map((f) => f.content),
    ].slice(0, 15),
    recommendations: [
      "Review the findings and the critic's open issues before relying on them.",
      "Re-run the task with a narrower objective or higher limits if more depth is needed.",
    ],
    conclusion: "Incomplete — requires human review.",
    confidence: "low",
    generatedAt: new Date().toISOString(),
  };
}
