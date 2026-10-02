import type { Prisma } from "@/generated/prisma/client";
import type {
  AgentName,
  AgentRunRecord,
  Confidence,
  EventType,
  FinalResult,
  MessageType,
  Participant,
  Recipient,
  SubtaskStatus,
  TaskRecord,
  Workspace,
} from "../domain";
import type { TaskRepository } from "../orchestration/repository";
import { getPrisma } from "./prisma";

const DEFAULT_USER_EMAIL = "demo@agentforge.local";

const json = (v: unknown) => (v === undefined || v === null ? undefined : (v as Prisma.InputJsonValue));

/** Postgres-backed repository. The database is the source of truth for every task. */
export class PrismaTaskRepository implements TaskRepository {
  private get db() {
    return getPrisma();
  }

  async createTask(input: Parameters<TaskRepository["createTask"]>[0]): Promise<TaskRecord> {
    const email = input.userEmail ?? DEFAULT_USER_EMAIL;
    const user = await this.db.user.upsert({ where: { email }, update: {}, create: { email, name: "Demo User" } });
    const task = await this.db.task.create({
      data: {
        userId: user.id,
        objective: input.objective,
        provider: input.provider,
        searchTool: input.searchTool,
        demoMode: input.demoMode,
      },
    });
    return toTask(task);
  }

  async getWorkspace(taskId: string): Promise<Workspace | null> {
    const task = await this.db.task.findUnique({
      where: { id: taskId },
      include: {
        subtasks: { orderBy: { createdAt: "asc" } },
        findings: { orderBy: { createdAt: "asc" }, include: { evidence: { orderBy: { createdAt: "asc" } } } },
        messages: { orderBy: { createdAt: "asc" } },
        decisions: { orderBy: { createdAt: "asc" } },
        events: { orderBy: { seq: "asc" } },
        agentRuns: { orderBy: { startedAt: "asc" } },
      },
    });
    if (!task) return null;
    return {
      task: toTask(task),
      subtasks: task.subtasks.map((s) => ({
        ...s,
        assignedTo: s.assignedTo as AgentName,
        origin: s.origin as AgentName,
        status: s.status as SubtaskStatus,
      })),
      findings: task.findings.map((f) => ({
        ...f,
        kind: f.kind as "FINDING" | "UNCERTAINTY",
        confidence: f.confidence as Confidence,
        evidence: f.evidence.map((e) => ({
          id: e.id,
          findingId: e.findingId,
          sourceId: e.sourceId,
          title: e.title,
          url: e.url,
          snippet: e.snippet,
          tool: e.tool,
          isMock: e.isMock,
        })),
      })),
      messages: task.messages.map((m) => ({
        ...m,
        fromAgent: m.fromAgent as Participant,
        toAgent: m.toAgent as Recipient,
        type: m.type as MessageType,
        metadata: (m.metadata as Record<string, unknown> | null) ?? null,
      })),
      decisions: task.decisions.map((d) => ({ ...d, agent: d.agent as AgentName })),
      events: task.events.map((e) => ({
        id: e.id,
        seq: e.seq,
        type: e.type as EventType,
        agent: (e.agent as Participant | null) ?? null,
        message: e.message,
        data: (e.data as Record<string, unknown> | null) ?? null,
        createdAt: e.createdAt,
      })),
      agentRuns: task.agentRuns.map(
        (r): AgentRunRecord => ({
          ...r,
          agent: r.agent as AgentName,
          status: r.status as AgentRunRecord["status"],
        }),
      ),
    };
  }

  async listTasks(limit: number) {
    return this.db.task.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, objective: true, status: true, createdAt: true },
    });
  }

  async updateTask(taskId: string, patch: Parameters<TaskRepository["updateTask"]>[1]) {
    const { finalResult, ...rest } = patch;
    await this.db.task.update({
      where: { id: taskId },
      data: { ...rest, ...(finalResult !== undefined ? { finalResult: json(finalResult) } : {}) },
    });
  }

  async createSubtasks(taskId: string, subtasks: Parameters<TaskRepository["createSubtasks"]>[1]) {
    const created = [];
    for (const s of subtasks) {
      const row = await this.db.subtask.create({ data: { ...s, taskId } });
      created.push({
        ...row,
        assignedTo: row.assignedTo as AgentName,
        origin: row.origin as AgentName,
        status: row.status as SubtaskStatus,
      });
    }
    return created;
  }

  async updateSubtask(subtaskId: string, patch: Parameters<TaskRepository["updateSubtask"]>[1]) {
    await this.db.subtask.update({ where: { id: subtaskId }, data: patch });
  }

  async createFindings(taskId: string, findings: Parameters<TaskRepository["createFindings"]>[1]) {
    await this.db.$transaction(
      findings.map(({ evidence, ...f }) =>
        this.db.finding.create({
          data: { ...f, taskId, evidence: { create: evidence.map((e) => ({ ...e, taskId })) } },
        }),
      ),
    );
  }

  async addMessage(taskId: string, m: Parameters<TaskRepository["addMessage"]>[1]) {
    await this.db.agentMessage.create({
      data: {
        taskId,
        fromAgent: m.fromAgent,
        toAgent: m.toAgent,
        type: m.type,
        content: m.content,
        reason: m.reason ?? null,
        metadata: json(m.metadata),
      },
    });
  }

  async addDecision(taskId: string, d: Parameters<TaskRepository["addDecision"]>[1]) {
    await this.db.decision.create({ data: { ...d, taskId } });
  }

  async addEvent(taskId: string, e: Parameters<TaskRepository["addEvent"]>[1]) {
    // The engine serialises event writes per task; the retry covers the rare case of
    // another writer (e.g. the API recording TASK_CREATED) racing for the same seq.
    let row;
    for (let attempt = 0; ; attempt++) {
      const last = await this.db.taskEvent.aggregate({ where: { taskId }, _max: { seq: true } });
      try {
        row = await this.db.taskEvent.create({
          data: { taskId, seq: (last._max.seq ?? 0) + 1, type: e.type, agent: e.agent ?? null, message: e.message, data: json(e.data) },
        });
        break;
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code !== "P2002" || attempt >= 4) throw error;
      }
    }
    return {
      id: row.id,
      seq: row.seq,
      type: row.type as EventType,
      agent: (row.agent as Participant | null) ?? null,
      message: row.message,
      data: (row.data as Record<string, unknown> | null) ?? null,
      createdAt: row.createdAt,
    };
  }

  async startAgentRun(taskId: string, run: Parameters<TaskRepository["startAgentRun"]>[1]) {
    const row = await this.db.agentRun.create({
      data: { taskId, agent: run.agent, purpose: run.purpose, iteration: run.iteration, status: "RUNNING", input: json(run.input) ?? {} },
    });
    return row.id;
  }

  async finishAgentRun(runId: string, r: Parameters<TaskRepository["finishAgentRun"]>[1]) {
    await this.db.agentRun.update({
      where: { id: runId },
      data: {
        status: r.status,
        output: json(r.output),
        error: r.error ?? null,
        attempts: r.attempts,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        costUsd: r.costUsd,
        model: r.model ?? null,
        durationMs: r.durationMs,
        finishedAt: new Date(),
      },
    });
  }
}

type TaskRow = Omit<TaskRecord, "finalResult"> & { finalResult: unknown };

function toTask(t: TaskRow): TaskRecord {
  return {
    id: t.id,
    objective: t.objective,
    status: t.status,
    currentStep: t.currentStep,
    iteration: t.iteration,
    agentCalls: t.agentCalls,
    inputTokens: t.inputTokens,
    outputTokens: t.outputTokens,
    estimatedCostUsd: t.estimatedCostUsd,
    provider: t.provider,
    searchTool: t.searchTool,
    demoMode: t.demoMode,
    finalResult: (t.finalResult as FinalResult | null) ?? null,
    error: t.error,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    startedAt: t.startedAt,
    completedAt: t.completedAt,
  };
}
