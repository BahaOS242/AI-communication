import "dotenv/config";
import { describe, expect, it } from "vitest";
import { DemoProvider } from "@/lib/ai/providers/demo";
import { DEFAULT_LIMITS } from "@/lib/config";
import { PrismaTaskRepository } from "@/lib/db/prisma-repository";
import { OrchestrationEngine } from "@/lib/orchestration/engine";
import { toTaskSnapshot } from "@/lib/orchestration/snapshot";
import { MockSearchTool } from "@/lib/tools/mock-search";

/** Runs the full demo loop against a real Postgres database when DATABASE_URL is set. */
describe.skipIf(!process.env.DATABASE_URL)("Prisma repository (Postgres)", () => {
  it("persists a complete, reconstructable task history", async () => {
    const repo = new PrismaTaskRepository();
    const task = await repo.createTask({
      objective: "Determine whether a tourist-focused Pilates package would be viable in Nassau.",
      provider: "demo",
      searchTool: "demo-dataset",
      demoMode: true,
      userEmail: "test@agentforge.local",
    });
    const engine = new OrchestrationEngine({ repo, provider: new DemoProvider(), search: new MockSearchTool(), limits: DEFAULT_LIMITS });
    await engine.run(task.id);

    const ws = (await repo.getWorkspace(task.id))!;
    expect(ws.task.status).toBe("COMPLETED");
    expect(ws.task.finalResult?.kind).toBe("complete");
    expect(ws.events.map((e) => e.seq)).toEqual(ws.events.map((_, i) => i + 1));
    expect(ws.events.map((e) => e.type)).toContain("CRITIC_REQUESTED_MORE_WORK");
    expect(ws.findings.some((f) => f.evidence.length > 0)).toBe(true);
    expect(ws.agentRuns.every((r) => r.status === "COMPLETED")).toBe(true);
    expect(ws.decisions.length).toBe(ws.task.iteration);

    const snapshot = toTaskSnapshot(ws);
    expect(typeof snapshot.task.createdAt).toBe("string");
    expect(snapshot.agents.map((a) => a.state)).toEqual(["done", "done", "done"]);
  });
});
