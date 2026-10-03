/**
 * Run one AgentForge task from the terminal, printing the agent conversation live.
 *
 *   npm run task -- "Determine whether a tourist-focused Pilates package would be viable in Nassau."
 *   npm run task -- --memory "..."     # skip Postgres, keep everything in memory
 *
 * Uses the same provider/search configuration as the app (.env).
 */
import "dotenv/config";
import { createProvider } from "@/lib/ai/provider";
import { limitsFromEnv, loadEnv } from "@/lib/config";
import type { FinalResult } from "@/lib/domain";
import { OrchestrationEngine } from "@/lib/orchestration/engine";
import { InMemoryTaskRepository } from "@/lib/orchestration/memory-repository";
import type { TaskRepository } from "@/lib/orchestration/repository";
import { createLogger } from "@/lib/observability/logger";
import { createSearchTool } from "@/lib/tools/search";

const COLORS: Record<string, string> = { manager: "\x1b[35m", researcher: "\x1b[36m", critic: "\x1b[33m", system: "\x1b[90m", user: "\x1b[32m" };
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const paint = (who: string, s: string) => `${COLORS[who] ?? ""}${s}${RESET}`;

/** Wraps a repository to echo messages and notable events as they are written. */
function withEcho(repo: TaskRepository): TaskRepository {
  const started = Date.now();
  const t = () => `${DIM}+${((Date.now() - started) / 1000).toFixed(1)}s${RESET}`;
  return new Proxy(repo, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === "addMessage") {
        return async (taskId: string, m: Parameters<TaskRepository["addMessage"]>[1]) => {
          console.log(`\n${t()} ${paint(m.fromAgent, m.fromAgent.toUpperCase())} → ${m.toAgent}  [${m.type}]`);
          console.log(`   ${m.content}`);
          if (m.reason) console.log(`   ${DIM}why: ${m.reason}${RESET}`);
          return (value as TaskRepository["addMessage"]).call(target, taskId, m);
        };
      }
      if (prop === "addEvent") {
        return async (taskId: string, e: Parameters<TaskRepository["addEvent"]>[1]) => {
          if (["TOOL_CALLED", "AGENT_RETRY", "AGENT_FAILED", "MANAGER_ACTION_REJECTED", "LIMIT_REACHED"].includes(e.type)) {
            console.log(`${t()}   ${DIM}${e.type}: ${e.message.slice(0, 200)}${RESET}`);
          }
          return (value as TaskRepository["addEvent"]).call(target, taskId, e);
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function printResult(result: FinalResult) {
  console.log(`\n${"═".repeat(80)}\n${result.kind === "complete" ? "FINAL RESULT" : "PARTIAL RESULT (requires review)"}  · confidence: ${result.confidence}\n${"═".repeat(80)}`);
  console.log(`\n${result.summary}\n\nKey findings:`);
  for (const f of result.keyFindings) console.log(`  • ${f.title} [${f.sourceIds.join(", ")}]\n    ${f.detail}`);
  console.log("\nUncertainties:");
  for (const u of result.uncertainties) console.log(`  ? ${u}`);
  console.log("\nRecommendations:");
  for (const r of result.recommendations) console.log(`  → ${r}`);
  console.log(`\nConclusion: ${result.conclusion}\n\nEvidence:`);
  for (const e of result.evidence) console.log(`  ${e.sourceId}  ${e.title}${e.url ? `  ${e.url}` : ""}`);
}

async function main() {
  const args = process.argv.slice(2);
  const memory = args.includes("--memory");
  const objective = args.filter((a) => a !== "--memory").join(" ").trim();
  if (objective.length < 10) {
    console.error('Usage: npm run task -- [--memory] "<objective>"');
    process.exit(1);
  }

  const env = loadEnv();
  const provider = createProvider(env);
  const search = createSearchTool(env);
  const baseRepo: TaskRepository = memory || !process.env.DATABASE_URL
    ? new InMemoryTaskRepository()
    : new (await import("@/lib/db/prisma-repository")).PrismaTaskRepository();
  const repo = withEcho(baseRepo);

  console.log(`AgentForge · provider ${provider.name}:${provider.model} · search ${search.name}${search.isMock ? " (offline demo data)" : ""} · ${memory || !process.env.DATABASE_URL ? "in-memory" : "postgres"}`);
  const task = await repo.createTask({ objective, provider: `${provider.name}:${provider.model}`, searchTool: search.name, demoMode: env.DEMO_MODE });
  await repo.addMessage(task.id, { fromAgent: "user", toAgent: "manager", type: "OBJECTIVE", content: objective });

  const engine = new OrchestrationEngine({
    repo,
    provider,
    search,
    limits: limitsFromEnv(env),
    logger: createLogger(process.env.LOG_LEVEL === "debug" ? "debug" : "warn"),
  });
  const started = Date.now();
  const final = await engine.run(task.id);

  if (final.finalResult) printResult(final.finalResult);
  console.log(
    `\nStatus ${final.status} · ${final.iteration} iterations · ${final.agentCalls} agent calls · ` +
      `${final.inputTokens.toLocaleString()} in / ${final.outputTokens.toLocaleString()} out tokens · ` +
      `~$${final.estimatedCostUsd.toFixed(4)} · ${((Date.now() - started) / 1000).toFixed(1)}s · task ${task.id}`,
  );
  if (final.error) console.log(`Stopped because: ${final.error}`);
  process.exit(final.status === "COMPLETED" ? 0 : 2);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
