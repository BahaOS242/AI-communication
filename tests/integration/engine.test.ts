import { describe, expect, it } from "vitest";
import { DemoProvider } from "@/lib/ai/providers/demo";
import { ProviderError } from "@/lib/ai/types";
import type { Workspace } from "@/lib/domain";
import type { SearchTool } from "@/lib/tools/types";
import { ScriptedProvider } from "../helpers/scripted-provider";
import {
  approved,
  complete,
  needsMoreWork,
  plan,
  queries,
  requestReview,
  researchReport,
  setup,
  synthesis,
} from "../helpers/fixtures";

const eventTypes = (ws: Workspace) => ws.events.map((e) => e.type);
const indexOf = (ws: Workspace, type: string, from = 0) => eventTypes(ws).indexOf(type as never, from);

describe("orchestration engine", () => {
  it("runs manager → researcher → critic → manager to completion", async () => {
    const provider = new ScriptedProvider({
      "manager/decide": [plan(["Identify competitors"]), requestReview, complete],
      "researcher/plan_queries": [queries],
      "researcher/report": [researchReport()],
      "critic/review": [approved],
      "manager/synthesize": [synthesis],
    });
    const { run } = await setup(provider);
    const ws = await run();

    expect(ws.task.status).toBe("COMPLETED");
    expect(ws.task.iteration).toBe(3);
    expect(ws.task.agentCalls).toBe(6); // 3 manager decisions + research + review + synthesis
    expect(ws.task.finalResult?.kind).toBe("complete");
    // Hallucinated source id S999 is stripped from the final result.
    expect(ws.task.finalResult?.keyFindings[0].sourceIds).toEqual(["S1"]);
    expect(ws.task.finalResult?.evidence[0].isMock).toBe(true);

    const order = ["MANAGER_PLANNED", "FINDING_CREATED", "CRITIC_APPROVED", "TASK_COMPLETED"].map((t) => indexOf(ws, t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    expect(ws.messages.map((m) => `${m.fromAgent}->${m.toAgent}:${m.type}`)).toEqual([
      "manager->researcher:PLAN",
      "researcher->manager:RESEARCH_RESULT",
      "manager->critic:REVIEW_REQUEST",
      "critic->manager:APPROVED",
      "manager->team:DECISION",
      "manager->user:FINAL_RESULT",
    ]);
    expect(ws.agentRuns.every((r) => r.status === "COMPLETED" && r.durationMs !== null)).toBe(true);
    expect(ws.task.inputTokens).toBeGreaterThan(0);
  });

  it("iterates when the critic requests more work: researcher → critic → researcher → critic → manager", async () => {
    const provider = new ScriptedProvider({
      "manager/decide": [
        plan(["Identify competitors"]),
        requestReview,
        plan(["Investigate tourist-specific pricing"]),
        requestReview,
        complete,
      ],
      "researcher/plan_queries": [queries],
      "researcher/report": [researchReport("Competitors exist"), researchReport("Tourists pay a premium")],
      "critic/review": [needsMoreWork("Investigate tourist-specific pricing"), approved],
      "manager/synthesize": [synthesis],
    });
    const { run } = await setup(provider);
    const ws = await run();

    expect(ws.task.status).toBe("COMPLETED");
    const types = eventTypes(ws);
    const more = types.indexOf("CRITIC_REQUESTED_MORE_WORK");
    const reassigned = types.indexOf("MANAGER_REASSIGNED_TASK");
    const approvedAt = types.indexOf("CRITIC_APPROVED");
    expect(more).toBeGreaterThan(-1);
    expect(reassigned).toBeGreaterThan(more);
    expect(approvedAt).toBeGreaterThan(reassigned);
    expect(types.at(-1)).toBe("TASK_COMPLETED");

    // The follow-up subtask is attributed to the critic that asked for it.
    expect(ws.subtasks.map((s) => [s.title, s.origin])).toEqual([
      ["Identify competitors", "manager"],
      ["Investigate tourist-specific pricing", "critic"],
    ]);
    // Status passed through NEEDS_MORE_WORK.
    expect(ws.events.some((e) => e.type === "STATUS_CHANGED" && e.data?.to === "NEEDS_MORE_WORK")).toBe(true);
    expect(provider.count("critic/review")).toBe(2);
    expect(provider.count("researcher/report")).toBe(2);
  });

  it("demo mode drives the full autonomous loop end-to-end", async () => {
    const { run } = await setup(new DemoProvider());
    const ws = await run();

    expect(ws.task.status).toBe("COMPLETED");
    expect(eventTypes(ws)).toContain("CRITIC_REQUESTED_MORE_WORK");
    expect(eventTypes(ws)).toContain("MANAGER_REASSIGNED_TASK");
    expect(ws.subtasks.length).toBe(5);
    expect(ws.subtasks.filter((s) => s.origin === "critic").length).toBe(2);
    expect(ws.task.finalResult?.summary).toMatch(/demo dataset/i);
    expect(ws.task.finalResult?.evidence.length).toBeGreaterThan(3);
    expect(ws.task.finalResult?.evidence.every((e) => e.isMock && e.url === null)).toBe(true);
    expect(ws.task.iteration).toBeLessThanOrEqual(10);
  });

  it("recovers from malformed AI responses by retrying with feedback", async () => {
    const provider = new ScriptedProvider({
      "manager/decide": [
        "Sure! I think we should research competitors.", // not JSON
        { action: "ASSIGN_RESEARCH", reason: "x", message: "y", tasks: [] }, // schema violation
        plan(["Identify competitors"]),
        requestReview,
        complete,
      ],
      "researcher/plan_queries": [queries],
      "researcher/report": ['```json\n{"status":"COMPLETED"}\n```', researchReport()],
      "critic/review": [{ decision: "MAYBE" }, approved],
      "manager/synthesize": [synthesis],
    });
    const { run } = await setup(provider);
    const ws = await run();

    expect(ws.task.status).toBe("COMPLETED");
    const retries = ws.events.filter((e) => e.type === "AGENT_RETRY");
    expect(retries.length).toBe(4);
    expect(retries[0].message).toMatch(/Invalid JSON/);
    expect(retries[1].message).toMatch(/ASSIGN_RESEARCH requires at least one task/);
    // The corrective prompt tells the model what was wrong.
    const third = provider.calls.filter((c) => c.purpose === "decide")[2];
    expect(third.prompt).toMatch(/previous response was rejected/);
    expect(ws.agentRuns.find((r) => r.purpose === "decide")?.attempts).toBe(3);
  });

  it("stops with FAILED_REQUIRES_REVIEW when an agent keeps returning malformed output", async () => {
    const provider = new ScriptedProvider({ "manager/decide": ["not json at all"] });
    const { run } = await setup(provider, { maxRetries: 1, maxConsecutiveFailures: 2 });
    const ws = await run();

    expect(ws.task.status).toBe("FAILED_REQUIRES_REVIEW");
    expect(ws.task.error).toMatch(/consecutive agent failures/);
    expect(provider.count("manager/decide")).toBe(4); // 2 runs × (1 + 1 retry)
    expect(ws.agentRuns.every((r) => r.status === "FAILED")).toBe(true);
    expect(ws.task.finalResult?.kind).toBe("partial");
  });

  it("enforces MAX_ITERATIONS and returns the work completed so far", async () => {
    let n = 0;
    const provider = new ScriptedProvider({
      "manager/decide": [
        plan(["Topic 0"]),
        // Alternate review / follow-up research forever.
        (req) => {
          const ctx = req.context as { unreviewedFindingCount: number; latestReview: { outstandingRequests: { title: string; description: string }[] } | null };
          if (ctx.unreviewedFindingCount > 0) return requestReview;
          return { ...plan([]), tasks: ctx.latestReview?.outstandingRequests ?? [] };
        },
      ],
      "researcher/plan_queries": [queries],
      "researcher/report": [() => researchReport(`Finding ${n++}`)],
      "critic/review": [() => needsMoreWork(`Topic ${n}`)],
    });
    const { run } = await setup(provider, { maxIterations: 6 });
    const ws = await run();

    expect(ws.task.status).toBe("FAILED_REQUIRES_REVIEW");
    expect(ws.task.iteration).toBe(6);
    expect(ws.task.error).toMatch(/Maximum iterations reached \(6\)/);
    expect(eventTypes(ws)).toContain("LIMIT_REACHED");
    const result = ws.task.finalResult!;
    expect(result.kind).toBe("partial");
    expect(result.keyFindings.length).toBe(3);
    expect(result.uncertainties.some((u) => u.startsWith("Not yet researched"))).toBe(true);
    expect(provider.count("manager/synthesize")).toBe(0);
  });

  it("enforces MAX_AGENT_CALLS", async () => {
    const provider = new ScriptedProvider({
      "manager/decide": [plan(["A", "B", "C", "D"])],
      "researcher/plan_queries": [queries],
      "researcher/report": [(req) => researchReport(`Finding ${(req.context as { assignment: { title: string } }).assignment.title}`)],
    });
    const { run } = await setup(provider, { maxAgentCalls: 3 });
    const ws = await run();
    expect(ws.task.status).toBe("FAILED_REQUIRES_REVIEW");
    expect(ws.task.agentCalls).toBe(3);
    expect(ws.subtasks.filter((s) => s.status === "COMPLETED")).toHaveLength(2);
    expect(ws.subtasks.filter((s) => s.status === "PENDING")).toHaveLength(2);
  });

  it("handles a failed agent and lets the manager continue with what succeeded", async () => {
    const provider = new ScriptedProvider({
      "manager/decide": [plan(["Identify competitors", "Find pricing"]), requestReview, complete],
      "researcher/plan_queries": [queries],
      "researcher/report": [researchReport(), new ProviderError("upstream 400", false)],
      "critic/review": [approved],
      "manager/synthesize": [synthesis],
    });
    const { run } = await setup(provider);
    const ws = await run();

    expect(ws.task.status).toBe("COMPLETED");
    expect(ws.subtasks.map((s) => s.status)).toEqual(["COMPLETED", "FAILED"]);
    expect(ws.messages.some((m) => m.type === "AGENT_FAILED" && m.toAgent === "manager")).toBe(true);
    expect(ws.agentRuns.find((r) => r.status === "FAILED")?.error).toMatch(/upstream 400/);
    expect(eventTypes(ws)).toContain("AGENT_FAILED");
  });

  it("rejects a premature COMPLETE and feeds the reason back to the manager", async () => {
    const provider = new ScriptedProvider({
      "manager/decide": [plan(["Identify competitors"]), complete, requestReview, complete],
      "researcher/plan_queries": [queries],
      "researcher/report": [researchReport()],
      "critic/review": [approved],
      "manager/synthesize": [synthesis],
    });
    const { run } = await setup(provider);
    const ws = await run();

    expect(ws.task.status).toBe("COMPLETED");
    expect(ws.decisions.map((d) => [d.action, d.accepted])).toEqual([
      ["ASSIGN_RESEARCH", true],
      ["COMPLETE", false],
      ["REQUEST_REVIEW", true],
      ["COMPLETE", true],
    ]);
    const afterRejection = provider.calls.filter((c) => c.purpose === "decide")[2];
    expect(afterRejection.prompt).toMatch(/REJECTED by the engine/);
    expect(eventTypes(ws)).toContain("MANAGER_ACTION_REJECTED");
  });

  it("stops a manager that keeps proposing invalid actions", async () => {
    const provider = new ScriptedProvider({ "manager/decide": [complete] });
    const { run } = await setup(provider, { maxRejectedActions: 3 });
    const ws = await run();
    expect(ws.task.status).toBe("FAILED_REQUIRES_REVIEW");
    expect(ws.task.error).toMatch(/3 invalid actions/);
  });

  it("times out hung agent calls and stops", async () => {
    const hanging = new ScriptedProvider({});
    hanging.complete = () => new Promise(() => {});
    const { run } = await setup(hanging, { agentTimeoutMs: 30, maxRetries: 0, maxConsecutiveFailures: 2 });
    const ws = await run();
    expect(ws.task.status).toBe("FAILED_REQUIRES_REVIEW");
    expect(ws.agentRuns[0].error).toMatch(/timed out/);
  });

  it("enforces the overall task timeout", async () => {
    const slow = new ScriptedProvider({ "manager/decide": [plan(["A"])], "researcher/plan_queries": [queries] });
    const inner = slow.complete.bind(slow);
    slow.complete = async (req) => {
      await new Promise((r) => setTimeout(r, 40));
      return inner(req);
    };
    const { run } = await setup(slow, { taskTimeoutMs: 60 });
    const ws = await run();
    expect(ws.task.status).toBe("FAILED_REQUIRES_REVIEW");
    expect(ws.task.error).toMatch(/timeout/i);
  });

  it("drops citations to sources that were never retrieved", async () => {
    const provider = new ScriptedProvider({
      "manager/decide": [plan(["Identify competitors"]), "x"],
      "researcher/plan_queries": [queries],
      "researcher/report": [
        {
          status: "COMPLETED",
          summary: "s",
          findings: [{ title: "Made up", content: "c", confidence: "high", sourceIds: ["S42"] }],
          uncertainties: [],
        },
      ],
    });
    const { run } = await setup(provider, { maxConsecutiveFailures: 1, maxRetries: 0 });
    const ws = await run();
    const finding = ws.findings.find((f) => f.title === "Made up")!;
    expect(finding.evidence).toHaveLength(0);
    expect(finding.confidence).toBe("low");
    const msg = ws.messages.find((m) => m.type === "RESEARCH_RESULT")!;
    expect(msg.metadata?.droppedSourceIds).toEqual(["S42"]);
  });

  it("reports BLOCKED research when the search tool returns nothing", async () => {
    const empty: SearchTool = { name: "empty", isMock: true, search: async () => [] };
    const provider = new ScriptedProvider({
      "manager/decide": [plan(["Obscure topic"]), { action: "FAIL", reason: "No evidence", message: "Stopping.", tasks: [] }],
      "researcher/plan_queries": [queries],
    });
    const { run } = await setup(provider, {}, empty);
    const ws = await run();
    expect(ws.subtasks[0].status).toBe("BLOCKED");
    expect(ws.messages.some((m) => m.type === "BLOCKED" && m.fromAgent === "researcher")).toBe(true);
    expect(ws.task.status).toBe("FAILED");
    expect(provider.count("researcher/report")).toBe(0);
  });
});
