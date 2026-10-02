import type { ManagerDecision } from "../ai/schemas";
import type { ReviewRecord, TaskStatus, Workspace } from "../domain";

/**
 * Explicit task state machine. The engine may only move a task along these edges;
 * any other transition is a programming error and throws.
 */
const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  PENDING: ["PLANNING", "FAILED", "FAILED_REQUIRES_REVIEW"],
  PLANNING: ["RESEARCHING", "REVIEWING", "SYNTHESIZING", "FAILED", "FAILED_REQUIRES_REVIEW"],
  RESEARCHING: ["PLANNING", "FAILED", "FAILED_REQUIRES_REVIEW"],
  REVIEWING: ["PLANNING", "NEEDS_MORE_WORK", "FAILED", "FAILED_REQUIRES_REVIEW"],
  NEEDS_MORE_WORK: ["PLANNING", "FAILED", "FAILED_REQUIRES_REVIEW"],
  SYNTHESIZING: ["COMPLETED", "FAILED", "FAILED_REQUIRES_REVIEW"],
  COMPLETED: [],
  FAILED: [],
  FAILED_REQUIRES_REVIEW: [],
};

export const TERMINAL_STATUSES: readonly TaskStatus[] = ["COMPLETED", "FAILED", "FAILED_REQUIRES_REVIEW"];

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: TaskStatus,
    readonly to: TaskStatus,
  ) {
    super(`Invalid task transition ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

// ------------------------------------------------------------- workspace queries

export function reviews(ws: Workspace): ReviewRecord[] {
  return ws.messages
    .filter((m) => m.fromAgent === "critic" && (m.type === "APPROVED" || m.type === "NEEDS_MORE_WORK"))
    .map((m) => {
      const meta = (m.metadata ?? {}) as Partial<ReviewRecord>;
      return {
        messageId: m.id,
        decision: m.type as ReviewRecord["decision"],
        summary: m.content,
        reviewedFindingIds: meta.reviewedFindingIds ?? [],
        issues: meta.issues ?? [],
        requestedResearch: meta.requestedResearch ?? [],
        createdAt: m.createdAt,
      };
    });
}

export function latestReview(ws: Workspace): ReviewRecord | null {
  const all = reviews(ws);
  return all.length ? all[all.length - 1] : null;
}

/** Findings the critic has not yet seen. */
export function unreviewedFindings(ws: Workspace) {
  const reviewed = new Set(reviews(ws).flatMap((r) => r.reviewedFindingIds));
  return ws.findings.filter((f) => f.kind === "FINDING" && !reviewed.has(f.id));
}

export const normalizeTitle = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Research the critic asked for in its latest review that has not been assigned since. */
export function outstandingCriticRequests(ws: Workspace) {
  const review = latestReview(ws);
  if (!review || review.decision !== "NEEDS_MORE_WORK") return [];
  const assignedSince = new Set(
    ws.subtasks.filter((s) => s.createdAt >= review.createdAt).map((s) => normalizeTitle(s.title)),
  );
  return review.requestedResearch.filter((r) => !assignedSince.has(normalizeTitle(r.title)));
}

// ------------------------------------------------------------- manager guard

export type GuardResult = { ok: true } | { ok: false; reason: string };

/**
 * Completion criteria and sanity checks applied to every manager decision.
 * The manager is autonomous, but it cannot skip review, finish without approval,
 * or loop on work that is already done.
 */
export function validateManagerAction(decision: ManagerDecision, ws: Workspace): GuardResult {
  switch (decision.action) {
    case "ASSIGN_RESEARCH": {
      const completed = new Set(
        ws.subtasks.filter((s) => s.status === "COMPLETED").map((s) => normalizeTitle(s.title)),
      );
      const fresh = decision.tasks.filter((t) => !completed.has(normalizeTitle(t.title)));
      if (fresh.length === 0) {
        return {
          ok: false,
          reason: "Every assigned task duplicates research that is already completed. Assign new work, request a review, or complete.",
        };
      }
      return { ok: true };
    }
    case "REQUEST_REVIEW": {
      if (unreviewedFindings(ws).length === 0) {
        return {
          ok: false,
          reason: "There are no new findings since the last review. Assign research first, or complete if the critic has approved.",
        };
      }
      return { ok: true };
    }
    case "COMPLETE": {
      const review = latestReview(ws);
      if (!review || review.decision !== "APPROVED") {
        return {
          ok: false,
          reason: "Completion criteria not met: the critic has not approved the current findings.",
        };
      }
      if (unreviewedFindings(ws).length > 0) {
        return {
          ok: false,
          reason: "Completion criteria not met: new findings were added after the critic's approval and must be reviewed.",
        };
      }
      return { ok: true };
    }
    case "FAIL":
      return { ok: true };
  }
}
