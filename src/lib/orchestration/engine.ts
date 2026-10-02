import { managerDecide, managerSynthesize } from "../agents/manager";
import { criticReview } from "../agents/critic";
import { AgentRunError, runResearcher } from "../agents/researcher";
import type { AgentDeps, AgentResult } from "../agents/types";
import { AgentMessageSchema, type ManagerDecision } from "../ai/schemas";
import { StructuredOutputError } from "../ai/structured";
import type { AIProvider } from "../ai/types";
import type { EngineLimits } from "../config";
import type { AgentName, EventType, Participant, SubtaskRecord, TaskRecord, TaskStatus, Workspace } from "../domain";
import { silentLogger, type Logger } from "../observability/logger";
import type { SearchTool } from "../tools/types";
import { buildCriticView, buildManagerView, buildResearcherView, buildSynthesisView } from "./context";
import { buildFinalResult, buildPartialResult } from "./report";
import type { NewFinding, NewMessage, TaskRepository } from "./repository";
import {
  assertTransition,
  isTerminal,
  latestReview,
  normalizeTitle,
  outstandingCriticRequests,
  validateManagerAction,
} from "./state-machine";

export interface EngineDeps {
  repo: TaskRepository;
  provider: AIProvider;
  search: SearchTool;
  limits: EngineLimits;
  logger?: Logger;
  /** Pause between agent steps (demo pacing so humans can watch). */
  stepDelayMs?: number;
}

type Outcome<T> = { ok: true; value: T; runId: string } | { ok: false; error: string; runId: null };

/**
 * The orchestration engine. It owns the loop, the state machine and all safety
 * limits; the agents own the reasoning. Each iteration the manager inspects the
 * shared workspace and chooses the next action — nothing about the order
 * manager → researcher → critic is hard-coded.
 */
export class OrchestrationEngine {
  constructor(private readonly deps: EngineDeps) {}

  async run(taskId: string): Promise<TaskRecord> {
    const run = new TaskRun(this.deps, taskId);
    return run.execute();
  }
}

class TaskRun {
  private ws!: Workspace;
  private status: TaskStatus = "PENDING";
  private iteration = 0;
  private agentCalls = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private costUsd = 0;
  private consecutiveFailures = 0;
  private consecutiveRejections = 0;
  private rejectedAction: string | null = null;
  private startedAt = Date.now();
  private readonly abort = new AbortController();
  private readonly log: Logger;

  constructor(
    private readonly deps: EngineDeps,
    private readonly taskId: string,
  ) {
    this.log = (deps.logger ?? silentLogger).child({ taskId });
  }

  private get repo() {
    return this.deps.repo;
  }
  private get limits() {
    return this.deps.limits;
  }

  async execute(): Promise<TaskRecord> {
    await this.refresh();
    if (isTerminal(this.ws.task.status)) return this.ws.task;
    this.status = this.ws.task.status;
    this.iteration = this.ws.task.iteration;
    this.agentCalls = this.ws.task.agentCalls;
    this.inputTokens = this.ws.task.inputTokens;
    this.outputTokens = this.ws.task.outputTokens;
    this.costUsd = this.ws.task.estimatedCostUsd;

    const timer = setTimeout(() => this.abort.abort(new Error("Task timeout")), this.limits.taskTimeoutMs);
    try {
      await this.repo.updateTask(this.taskId, { startedAt: new Date() });
      await this.event("TASK_STARTED", "system", `Task started with ${this.deps.provider.name} provider and ${this.deps.search.name} search`, {
        limits: { ...this.limits },
      });
      await this.loop();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.error("engine crashed", { error: message });
      await this.stop("FAILED_REQUIRES_REVIEW", `Unexpected engine error: ${message}`).catch((e) =>
        this.log.error("failed to record engine failure", { error: String(e) }),
      );
    } finally {
      clearTimeout(timer);
    }
    await this.refresh();
    return this.ws.task;
  }

  // ------------------------------------------------------------------ loop

  private async loop(): Promise<void> {
    while (!isTerminal(this.status)) {
      const limit = this.limitReached();
      if (limit) {
        await this.event("LIMIT_REACHED", "system", limit, { iteration: this.iteration, agentCalls: this.agentCalls });
        await this.stop("FAILED_REQUIRES_REVIEW", limit);
        return;
      }
      if (this.consecutiveFailures >= this.limits.maxConsecutiveFailures) {
        await this.stop("FAILED_REQUIRES_REVIEW", `${this.consecutiveFailures} consecutive agent failures`);
        return;
      }

      this.iteration += 1;
      await this.persistCounters();
      if (this.status !== "PLANNING") await this.setStatus("PLANNING");
      await this.refresh();

      await this.event("MANAGER_STARTED", "manager", `Iteration ${this.iteration}: manager is deciding the next step`);
      const view = buildManagerView(this.ws, this.limits, this.agentCalls, this.rejectedAction);
      const decided = await this.callAgent("manager", "decide", view, (d) => managerDecide(d, view), "Deciding next step…");
      if (!decided.ok) continue; // counted as a failure; limits above stop runaway retries

      const decision = decided.value;
      const guard = validateManagerAction(decision, this.ws);
      await this.repo.addDecision(this.taskId, {
        agent: "manager",
        action: decision.action,
        reason: guard.ok ? decision.reason : `${decision.reason} [REJECTED: ${guard.reason}]`,
        accepted: guard.ok,
        iteration: this.iteration,
      });

      if (!guard.ok) {
        this.consecutiveRejections += 1;
        this.rejectedAction = `${decision.action} was rejected: ${guard.reason}`;
        await this.event("MANAGER_ACTION_REJECTED", "system", this.rejectedAction, { decision });
        await this.message({ fromAgent: "system", toAgent: "manager", type: "REJECTED_ACTION", content: guard.reason, reason: `Proposed action: ${decision.action}` });
        if (this.consecutiveRejections >= this.limits.maxRejectedActions) {
          await this.stop("FAILED_REQUIRES_REVIEW", `Manager proposed ${this.consecutiveRejections} invalid actions in a row`);
        }
        continue;
      }
      this.consecutiveRejections = 0;
      this.rejectedAction = null;
      await this.event("MANAGER_DECIDED", "manager", `${decision.action}: ${decision.reason}`, { action: decision.action });

      switch (decision.action) {
        case "ASSIGN_RESEARCH":
          await this.assignResearch(decision);
          break;
        case "REQUEST_REVIEW":
          await this.requestReview(decision);
          break;
        case "COMPLETE":
          await this.complete(decision);
          break;
        case "FAIL":
          await this.message({ fromAgent: "manager", toAgent: "user", type: "DECISION", content: decision.message, reason: decision.reason });
          await this.stop("FAILED", `Manager stopped the task: ${decision.reason}`);
          break;
      }
    }
  }

  // ------------------------------------------------------------------ actions

  private async assignResearch(decision: ManagerDecision): Promise<void> {
    const isFirstPlan = this.ws.subtasks.length === 0;
    const reassigning = latestReview(this.ws)?.decision === "NEEDS_MORE_WORK";
    const criticAsked = new Set(outstandingCriticRequests(this.ws).map((r) => normalizeTitle(r.title)));
    const completed = new Set(this.ws.subtasks.filter((s) => s.status === "COMPLETED").map((s) => normalizeTitle(s.title)));
    const fresh = decision.tasks.filter((t) => !completed.has(normalizeTitle(t.title)));

    await this.message({
      fromAgent: "manager",
      toAgent: "researcher",
      type: isFirstPlan ? "PLAN" : "ASSIGNMENT",
      content: decision.message,
      reason: decision.reason,
      metadata: { tasks: fresh },
    });
    const subtasks = await this.repo.createSubtasks(
      this.taskId,
      fresh.map((t) => ({
        title: t.title,
        description: t.description,
        assignedTo: "researcher" as const,
        origin: (criticAsked.has(normalizeTitle(t.title)) || reassigning ? "critic" : "manager") as AgentName,
        iteration: this.iteration,
      })),
    );
    if (isFirstPlan) {
      await this.event("MANAGER_PLANNED", "manager", `Plan created with ${subtasks.length} research task(s)`, {
        tasks: subtasks.map((s) => s.title),
      });
    } else if (reassigning) {
      await this.event("MANAGER_REASSIGNED_TASK", "manager", `Sent the researcher back: ${subtasks.map((s) => s.title).join("; ")}`);
    }

    await this.setStatus("RESEARCHING");
    for (const subtask of subtasks) {
      if (this.limitReached()) break;
      await this.research(subtask);
    }
  }

  private async research(subtask: SubtaskRecord): Promise<void> {
    await this.repo.updateSubtask(subtask.id, { status: "IN_PROGRESS" });
    await this.refresh();
    const view = buildResearcherView(this.ws, { ...subtask, status: "IN_PROGRESS" });
    const firstSource = nextSourceNumber(this.ws);

    const result = await this.callAgent(
      "researcher",
      "research",
      view,
      (d) => runResearcher(d, view, firstSource),
      `Researching: ${subtask.title}`,
    );

    if (!result.ok) {
      await this.repo.updateSubtask(subtask.id, { status: "FAILED", completedAt: new Date() });
      await this.message({
        fromAgent: "system",
        toAgent: "manager",
        type: "AGENT_FAILED",
        content: `The researcher failed on "${subtask.title}": ${result.error}`,
      });
      return;
    }

    const { report, sources, droppedSourceIds, queries } = result.value;
    const byId = new Map(sources.map((s) => [s.id, s]));
    const findings: NewFinding[] = [
      ...report.findings.map((f) => ({
        subtaskId: subtask.id,
        agentRunId: result.runId,
        kind: "FINDING" as const,
        title: f.title,
        content: f.content,
        confidence: f.confidence,
        iteration: this.iteration,
        evidence: f.sourceIds
          .map((id) => byId.get(id))
          .filter((s) => s !== undefined)
          .map((s) => ({
            sourceId: s.id,
            title: s.title,
            url: s.url,
            snippet: s.snippet,
            tool: this.deps.search.name,
            isMock: s.isMock,
          })),
      })),
      ...[...report.uncertainties, ...(report.blockedReason ? [report.blockedReason] : [])].map((u) => ({
        subtaskId: subtask.id,
        agentRunId: result.runId,
        kind: "UNCERTAINTY" as const,
        title: `Uncertainty: ${subtask.title}`,
        content: u,
        confidence: "low" as const,
        iteration: this.iteration,
        evidence: [],
      })),
    ];
    await this.repo.createFindings(this.taskId, findings);
    for (const f of report.findings) {
      await this.event("FINDING_CREATED", "researcher", f.title, { confidence: f.confidence, sourceIds: f.sourceIds });
    }

    const blocked = report.status === "BLOCKED";
    await this.repo.updateSubtask(subtask.id, { status: blocked ? "BLOCKED" : "COMPLETED", completedAt: new Date() });
    await this.message({
      fromAgent: "researcher",
      toAgent: "manager",
      type: blocked ? "BLOCKED" : "RESEARCH_RESULT",
      content: report.summary,
      reason: blocked ? (report.blockedReason ?? null) : null,
      metadata: {
        subtask: subtask.title,
        queries,
        findings: report.findings.map((f) => ({ title: f.title, confidence: f.confidence, sourceIds: f.sourceIds })),
        uncertainties: report.uncertainties,
        sourceCount: sources.length,
        droppedSourceIds,
      },
    });
  }

  private async requestReview(decision: ManagerDecision): Promise<void> {
    await this.message({
      fromAgent: "manager",
      toAgent: "critic",
      type: "REVIEW_REQUEST",
      content: decision.message,
      reason: decision.reviewFocus ?? decision.reason,
    });
    await this.setStatus("REVIEWING");
    const view = buildCriticView(this.ws, this.limits, decision.reviewFocus ?? null);
    const result = await this.callAgent("critic", "review", view, (d) => criticReview(d, view), "Reviewing findings…");

    if (!result.ok) {
      await this.message({ fromAgent: "system", toAgent: "manager", type: "AGENT_FAILED", content: `The critic failed to review: ${result.error}` });
      await this.setStatus("PLANNING");
      return;
    }
    const review = result.value;
    await this.message({
      fromAgent: "critic",
      toAgent: "manager",
      type: review.decision,
      content: review.summary,
      reason: review.issues.length ? review.issues.map((i) => `[${i.severity}] ${i.description}`).join(" ") : null,
      metadata: {
        reviewedFindingIds: view.findings.map((f) => f.id),
        issues: review.issues,
        requestedResearch: review.requestedResearch,
      },
    });
    if (review.decision === "APPROVED") {
      await this.event("CRITIC_APPROVED", "critic", "Research approved", { issues: review.issues.length });
      await this.setStatus("PLANNING");
    } else {
      await this.event("CRITIC_REQUESTED_MORE_WORK", "critic", review.requestedResearch.map((r) => r.title).join("; "), {
        issues: review.issues,
      });
      await this.setStatus("NEEDS_MORE_WORK");
    }
  }

  private async complete(decision: ManagerDecision): Promise<void> {
    await this.message({ fromAgent: "manager", toAgent: "team", type: "DECISION", content: decision.message, reason: decision.reason });
    await this.setStatus("SYNTHESIZING");
    await this.refresh();
    const view = buildSynthesisView(this.ws);
    const result = await this.callAgent("manager", "synthesize", view, (d) => managerSynthesize(d, view), "Writing final result…");
    if (!result.ok) {
      await this.stop("FAILED_REQUIRES_REVIEW", `Final synthesis failed: ${result.error}`);
      return;
    }
    await this.refresh();
    const final = buildFinalResult(this.ws, result.value);
    await this.message({ fromAgent: "manager", toAgent: "user", type: "FINAL_RESULT", content: final.summary });
    await this.repo.updateTask(this.taskId, { finalResult: final, completedAt: new Date(), currentStep: "Completed" });
    await this.setStatus("COMPLETED", "Completed");
    await this.event("TASK_COMPLETED", "manager", "Task complete — final result delivered", {
      iterations: this.iteration,
      agentCalls: this.agentCalls,
    });
  }

  // ------------------------------------------------------------------ helpers

  /**
   * Invoke an agent with full observability: AgentRun row, events, usage
   * accounting and failure capture. Never throws for agent-level failures.
   */
  private async callAgent<T>(
    agent: AgentName,
    purpose: string,
    input: unknown,
    fn: (deps: AgentDeps) => Promise<AgentResult<T>>,
    step: string,
  ): Promise<Outcome<T>> {
    this.agentCalls += 1;
    await this.repo.updateTask(this.taskId, { currentStep: step, agentCalls: this.agentCalls });
    const runId = await this.repo.startAgentRun(this.taskId, { agent, purpose, iteration: this.iteration, input });
    await this.event("AGENT_STARTED", agent, step, { purpose, runId });
    const started = Date.now();
    const pendingWrites: Promise<unknown>[] = [];

    const deps: AgentDeps = {
      provider: this.deps.provider,
      search: this.deps.search,
      maxRetries: this.limits.maxRetries,
      timeoutMs: this.limits.agentTimeoutMs,
      signal: this.abort.signal,
      onRetry: (i) =>
        pendingWrites.push(this.event("AGENT_RETRY", agent, `Retrying ${i.purpose} (attempt ${i.attempt + 1}): ${i.error}`, i)),
      onToolCall: (t) =>
        pendingWrites.push(
          this.event("TOOL_CALLED", agent, `${t.tool}("${t.input}") → ${t.error ? `error: ${t.error}` : `${t.resultCount} result(s)`}`, { ...t }),
        ),
    };

    try {
      const result = await fn(deps);
      await Promise.all(pendingWrites);
      this.addUsage(result.usage.inputTokens, result.usage.outputTokens, result.costUsd);
      const durationMs = Date.now() - started;
      await this.repo.finishAgentRun(runId, {
        status: "COMPLETED",
        output: result.output,
        attempts: result.attempts,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        costUsd: result.costUsd,
        model: result.model,
        durationMs,
      });
      await this.persistCounters();
      await this.event("AGENT_COMPLETED", agent, `${purpose} completed in ${(durationMs / 1000).toFixed(1)}s`, { purpose, runId, durationMs });
      this.log.info("agent run completed", { agent, purpose, iteration: this.iteration, durationMs, attempts: result.attempts });
      this.consecutiveFailures = 0;
      await this.pace();
      return { ok: true, value: result.output, runId };
    } catch (error) {
      await Promise.allSettled(pendingWrites);
      const message = error instanceof Error ? error.message : String(error);
      const usage =
        error instanceof StructuredOutputError
          ? { i: error.usage.inputTokens, o: error.usage.outputTokens, c: error.costUsd, a: error.attempts }
          : error instanceof AgentRunError
            ? { i: error.usage.inputTokens, o: error.usage.outputTokens, c: error.usage.costUsd, a: error.usage.attempts }
            : { i: 0, o: 0, c: 0, a: 1 };
      this.addUsage(usage.i, usage.o, usage.c);
      const durationMs = Date.now() - started;
      await this.repo.finishAgentRun(runId, {
        status: "FAILED",
        error: message,
        attempts: usage.a,
        inputTokens: usage.i,
        outputTokens: usage.o,
        costUsd: usage.c,
        durationMs,
      });
      await this.persistCounters();
      this.consecutiveFailures += 1;
      await this.event("AGENT_FAILED", agent, `${purpose} failed: ${message}`, { purpose, runId, attempts: usage.a });
      this.log.warn("agent run failed", { agent, purpose, iteration: this.iteration, error: message });
      return { ok: false, error: message, runId: null };
    }
  }

  private limitReached(): string | null {
    if (this.iteration >= this.limits.maxIterations) return `Maximum iterations reached (${this.limits.maxIterations})`;
    if (this.agentCalls >= this.limits.maxAgentCalls) return `Maximum agent calls reached (${this.limits.maxAgentCalls})`;
    if (Date.now() - this.startedAt >= this.limits.taskTimeoutMs || this.abort.signal.aborted)
      return `Task timeout reached (${Math.round(this.limits.taskTimeoutMs / 1000)}s)`;
    return null;
  }

  private async stop(target: "FAILED" | "FAILED_REQUIRES_REVIEW", reason: string): Promise<void> {
    if (isTerminal(this.status)) return;
    await this.refresh();
    const partial = buildPartialResult(this.ws, reason);
    await this.repo.updateTask(this.taskId, { finalResult: partial, error: reason, completedAt: new Date() });
    await this.setStatus(target, target === "FAILED" ? "Failed" : "Stopped — requires review");
    await this.event("TASK_FAILED", "system", reason, { status: target });
    this.log.warn("task stopped", { reason, status: target });
  }

  private async setStatus(to: TaskStatus, step?: string): Promise<void> {
    assertTransition(this.status, to);
    const from = this.status;
    this.status = to;
    await this.repo.updateTask(this.taskId, { status: to, ...(step ? { currentStep: step } : {}) });
    await this.event("STATUS_CHANGED", "system", `${from} → ${to}`, { from, to });
  }

  private async message(m: NewMessage): Promise<void> {
    // Validate the envelope before it enters the shared workspace.
    const valid = AgentMessageSchema.parse({ taskId: this.taskId, ...m });
    await this.repo.addMessage(this.taskId, { ...m, content: valid.content });
    await this.event("MESSAGE_SENT", m.fromAgent, `${m.fromAgent} → ${m.toAgent}: ${m.type}`, { type: m.type });
  }

  /** Events are written strictly in order (callbacks may fire concurrently). */
  private eventQueue: Promise<unknown> = Promise.resolve();
  private event(type: EventType, agent: Participant | null, message: string, data?: Record<string, unknown>) {
    const write = this.eventQueue.then(() => this.repo.addEvent(this.taskId, { type, agent, message, data: data ?? null }));
    this.eventQueue = write.catch(() => undefined);
    return write;
  }

  private addUsage(input: number, output: number, cost: number) {
    this.inputTokens += input;
    this.outputTokens += output;
    this.costUsd += cost;
  }

  private persistCounters() {
    return this.repo.updateTask(this.taskId, {
      iteration: this.iteration,
      agentCalls: this.agentCalls,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      estimatedCostUsd: this.costUsd,
    });
  }

  private async refresh() {
    const ws = await this.repo.getWorkspace(this.taskId);
    if (!ws) throw new Error(`Task ${this.taskId} not found`);
    this.ws = ws;
  }

  private async pace() {
    const ms = this.deps.stepDelayMs ?? 0;
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  }
}

function nextSourceNumber(ws: Workspace): number {
  let max = 0;
  for (const f of ws.findings)
    for (const e of f.evidence) {
      const n = Number.parseInt(e.sourceId.replace(/^S/, ""), 10);
      if (Number.isFinite(n)) max = Math.max(max, n);
    }
  return max + 1;
}
