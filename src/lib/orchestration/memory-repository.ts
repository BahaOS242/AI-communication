import { randomUUID } from "node:crypto";
import type { TaskRecord, Workspace } from "../domain";
import type { TaskRepository } from "./repository";

/** In-memory repository used by tests (and usable for local experiments). */
export class InMemoryTaskRepository implements TaskRepository {
  private readonly store = new Map<string, Workspace>();
  /** Monotonic clock so ordering is stable even within the same millisecond. */
  private tick = Date.now();
  private now() {
    this.tick += 1;
    return new Date(this.tick);
  }

  private ws(taskId: string): Workspace {
    const ws = this.store.get(taskId);
    if (!ws) throw new Error(`Task ${taskId} not found`);
    return ws;
  }

  async createTask(input: Parameters<TaskRepository["createTask"]>[0]): Promise<TaskRecord> {
    const now = this.now();
    const task: TaskRecord = {
      id: randomUUID(),
      objective: input.objective,
      status: "PENDING",
      currentStep: null,
      iteration: 0,
      agentCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      provider: input.provider,
      searchTool: input.searchTool,
      demoMode: input.demoMode,
      finalResult: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
    };
    this.store.set(task.id, {
      task,
      subtasks: [],
      findings: [],
      messages: [],
      decisions: [],
      events: [],
      agentRuns: [],
    });
    return { ...task };
  }

  async getWorkspace(taskId: string): Promise<Workspace | null> {
    const ws = this.store.get(taskId);
    return ws ? structuredClone(ws) : null;
  }

  async listTasks(limit: number) {
    return [...this.store.values()]
      .map((w) => ({ id: w.task.id, objective: w.task.objective, status: w.task.status, createdAt: w.task.createdAt }))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async updateTask(taskId: string, patch: Parameters<TaskRepository["updateTask"]>[1]) {
    const ws = this.ws(taskId);
    ws.task = { ...ws.task, ...patch, updatedAt: this.now() };
  }

  async createSubtasks(taskId: string, subtasks: Parameters<TaskRepository["createSubtasks"]>[1]) {
    const ws = this.ws(taskId);
    const created = subtasks.map((s) => ({
      ...s,
      id: randomUUID(),
      taskId,
      status: "PENDING" as const,
      createdAt: this.now(),
      completedAt: null,
    }));
    ws.subtasks.push(...created);
    return structuredClone(created);
  }

  async updateSubtask(subtaskId: string, patch: Parameters<TaskRepository["updateSubtask"]>[1]) {
    for (const ws of this.store.values()) {
      const s = ws.subtasks.find((x) => x.id === subtaskId);
      if (s) Object.assign(s, patch);
    }
  }

  async createFindings(taskId: string, findings: Parameters<TaskRepository["createFindings"]>[1]) {
    const ws = this.ws(taskId);
    for (const f of findings) {
      const id = randomUUID();
      ws.findings.push({
        ...f,
        id,
        taskId,
        createdAt: this.now(),
        evidence: f.evidence.map((e) => ({ ...e, id: randomUUID(), findingId: id })),
      });
    }
  }

  async addMessage(taskId: string, m: Parameters<TaskRepository["addMessage"]>[1]) {
    this.ws(taskId).messages.push({
      id: randomUUID(),
      taskId,
      fromAgent: m.fromAgent,
      toAgent: m.toAgent,
      type: m.type,
      content: m.content,
      reason: m.reason ?? null,
      metadata: m.metadata ?? null,
      createdAt: this.now(),
    });
  }

  async addDecision(taskId: string, d: Parameters<TaskRepository["addDecision"]>[1]) {
    this.ws(taskId).decisions.push({ ...d, id: randomUUID(), createdAt: this.now() });
  }

  async addEvent(taskId: string, e: Parameters<TaskRepository["addEvent"]>[1]) {
    const ws = this.ws(taskId);
    const record = {
      id: randomUUID(),
      seq: ws.events.length + 1,
      type: e.type,
      agent: e.agent ?? null,
      message: e.message,
      data: e.data ?? null,
      createdAt: this.now(),
    };
    ws.events.push(record);
    return { ...record };
  }

  async startAgentRun(taskId: string, run: Parameters<TaskRepository["startAgentRun"]>[1]) {
    const id = randomUUID();
    this.ws(taskId).agentRuns.push({
      ...run,
      id,
      status: "RUNNING",
      output: null,
      error: null,
      attempts: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      model: null,
      durationMs: null,
      startedAt: this.now(),
      finishedAt: null,
    });
    return id;
  }

  async finishAgentRun(runId: string, result: Parameters<TaskRepository["finishAgentRun"]>[1]) {
    for (const ws of this.store.values()) {
      const run = ws.agentRuns.find((r) => r.id === runId);
      if (run) Object.assign(run, { ...result, output: result.output ?? null, error: result.error ?? null, model: result.model ?? null, finishedAt: this.now() });
    }
  }
}
