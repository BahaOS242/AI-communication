import type { EngineLimits } from "../config";
import type { FindingRecord, SubtaskRecord, Workspace } from "../domain";
import { latestReview, outstandingCriticRequests, reviews, unreviewedFindings } from "./state-machine";

/**
 * Selective memory. Each agent receives a purpose-built view of the shared
 * workspace instead of the full transcript, which keeps prompts small and
 * keeps each agent focused on its own responsibility.
 */

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export interface ManagerView {
  objective: string;
  iteration: number;
  maxIterations: number;
  agentCallsRemaining: number;
  subtasks: { title: string; status: string; requestedBy: string }[];
  findings: { title: string; confidence: string; reviewed: boolean; summary: string }[];
  openUncertainties: string[];
  unreviewedFindingCount: number;
  latestReview: {
    decision: string;
    summary: string;
    issues: { type: string; description: string; severity: string }[];
    outstandingRequests: { title: string; description: string }[];
  } | null;
  recentMessages: { from: string; to: string; type: string; content: string }[];
  rejectedAction: string | null;
}

export function buildManagerView(
  ws: Workspace,
  limits: EngineLimits,
  agentCalls: number,
  rejectedAction: string | null,
): ManagerView {
  const unreviewed = new Set(unreviewedFindings(ws).map((f) => f.id));
  const review = latestReview(ws);
  return {
    objective: ws.task.objective,
    iteration: ws.task.iteration,
    maxIterations: limits.maxIterations,
    agentCallsRemaining: Math.max(0, limits.maxAgentCalls - agentCalls),
    subtasks: ws.subtasks.map((s) => ({ title: s.title, status: s.status, requestedBy: s.origin })),
    findings: ws.findings
      .filter((f) => f.kind === "FINDING")
      .map((f) => ({
        title: f.title,
        confidence: f.confidence,
        reviewed: !unreviewed.has(f.id),
        summary: clip(f.content, 220),
      })),
    openUncertainties: ws.findings
      .filter((f) => f.kind === "UNCERTAINTY")
      .slice(-6)
      .map((f) => clip(f.content, 200)),
    unreviewedFindingCount: unreviewed.size,
    latestReview: review
      ? {
          decision: review.decision,
          summary: review.summary,
          issues: review.issues,
          outstandingRequests: outstandingCriticRequests(ws),
        }
      : null,
    recentMessages: ws.messages.slice(-6).map((m) => ({
      from: m.fromAgent,
      to: m.toAgent,
      type: m.type,
      content: clip(m.content, 280),
    })),
    rejectedAction,
  };
}

export interface ResearcherView {
  objective: string;
  assignment: { title: string; description: string; requestedBy: string };
  /** Why the critic asked for this, when applicable. */
  criticConcerns: string[];
  /** Titles only, so the researcher avoids duplicating existing work. */
  alreadyKnown: string[];
}

export function buildResearcherView(ws: Workspace, subtask: SubtaskRecord): ResearcherView {
  const review = latestReview(ws);
  return {
    objective: ws.task.objective,
    assignment: { title: subtask.title, description: subtask.description, requestedBy: subtask.origin },
    criticConcerns:
      subtask.origin === "critic" && review ? review.issues.map((i) => `${i.type}: ${i.description}`) : [],
    alreadyKnown: ws.findings.filter((f) => f.kind === "FINDING").map((f) => f.title),
  };
}

export interface CriticView {
  objective: string;
  reviewRound: number;
  iterationsRemaining: number;
  focus: string | null;
  subtasks: { title: string; status: string }[];
  findings: {
    id: string;
    title: string;
    content: string;
    confidence: string;
    isNew: boolean;
    sources: { sourceId: string; title: string; snippet: string; isMock: boolean }[];
  }[];
  uncertainties: string[];
  previousReviews: { decision: string; summary: string; requested: string[] }[];
}

export function buildCriticView(ws: Workspace, limits: EngineLimits, focus: string | null): CriticView {
  const unreviewed = new Set(unreviewedFindings(ws).map((f) => f.id));
  const past = reviews(ws);
  return {
    objective: ws.task.objective,
    reviewRound: past.length + 1,
    iterationsRemaining: Math.max(0, limits.maxIterations - ws.task.iteration),
    focus,
    subtasks: ws.subtasks.map((s) => ({ title: s.title, status: s.status })),
    findings: ws.findings.filter((f) => f.kind === "FINDING").map((f) => findingForReview(f, unreviewed.has(f.id))),
    uncertainties: ws.findings.filter((f) => f.kind === "UNCERTAINTY").map((f) => f.content),
    previousReviews: past.map((r) => ({
      decision: r.decision,
      summary: r.summary,
      requested: r.requestedResearch.map((x) => x.title),
    })),
  };
}

function findingForReview(f: FindingRecord, isNew: boolean) {
  return {
    id: f.id,
    title: f.title,
    content: f.content,
    confidence: f.confidence,
    isNew,
    sources: f.evidence.map((e) => ({
      sourceId: e.sourceId,
      title: e.title,
      snippet: clip(e.snippet, 400),
      isMock: e.isMock,
    })),
  };
}

export interface SynthesisView {
  objective: string;
  findings: { title: string; content: string; confidence: string; sourceIds: string[] }[];
  sources: { sourceId: string; title: string; isMock: boolean }[];
  uncertainties: string[];
  criticAssessment: string | null;
  usesDemoData: boolean;
}

export function buildSynthesisView(ws: Workspace): SynthesisView {
  const review = latestReview(ws);
  const sources = uniqueSources(ws);
  return {
    objective: ws.task.objective,
    findings: ws.findings
      .filter((f) => f.kind === "FINDING")
      .map((f) => ({
        title: f.title,
        content: f.content,
        confidence: f.confidence,
        sourceIds: f.evidence.map((e) => e.sourceId),
      })),
    sources: sources.map((s) => ({ sourceId: s.sourceId, title: s.title, isMock: s.isMock })),
    uncertainties: ws.findings.filter((f) => f.kind === "UNCERTAINTY").map((f) => f.content),
    criticAssessment: review?.summary ?? null,
    usesDemoData: sources.some((s) => s.isMock),
  };
}

export function uniqueSources(ws: Workspace) {
  const seen = new Map<string, FindingRecord["evidence"][number]>();
  for (const f of ws.findings) for (const e of f.evidence) if (!seen.has(e.sourceId)) seen.set(e.sourceId, e);
  return [...seen.values()];
}
