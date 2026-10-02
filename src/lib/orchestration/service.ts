import { createProvider } from "../ai/provider";
import { limitsFromEnv, loadEnv } from "../config";
import { PrismaTaskRepository } from "../db/prisma-repository";
import { createLogger } from "../observability/logger";
import { createSearchTool } from "../tools/search";
import { OrchestrationEngine } from "./engine";

/**
 * Application service used by the API routes. Tasks run in-process in the
 * background; the UI follows progress from the database via SSE.
 * (A job queue would replace `void engine.run()` for multi-instance deployments.)
 */
const running = (globalThis as unknown as { __agentforgeRunning?: Set<string> }).__agentforgeRunning ?? new Set<string>();
(globalThis as unknown as { __agentforgeRunning?: Set<string> }).__agentforgeRunning = running;

const logger = createLogger();

export function getRepository() {
  return new PrismaTaskRepository();
}

export function runtimeInfo() {
  const env = loadEnv();
  const search = createSearchTool(env);
  let provider = "unconfigured";
  try {
    provider = createProvider(env).name;
  } catch {
    /* reported when a task is started */
  }
  return { demoMode: env.DEMO_MODE, provider, searchTool: search.name, searchIsMock: search.isMock };
}

export async function startTask(objective: string): Promise<{ id: string }> {
  const env = loadEnv();
  const provider = createProvider(env);
  const search = createSearchTool(env);
  const repo = getRepository();

  const task = await repo.createTask({
    objective,
    provider: `${provider.name}:${provider.model}`,
    searchTool: search.name,
    demoMode: env.DEMO_MODE,
  });
  await repo.addEvent(task.id, { type: "TASK_CREATED", agent: "user", message: "Objective submitted" });
  await repo.addMessage(task.id, { fromAgent: "user", toAgent: "manager", type: "OBJECTIVE", content: objective });

  const engine = new OrchestrationEngine({
    repo,
    provider,
    search,
    limits: limitsFromEnv(env),
    logger,
    stepDelayMs: env.DEMO_MODE ? env.DEMO_STEP_DELAY_MS : 0,
  });

  running.add(task.id);
  void engine
    .run(task.id)
    .catch((error) => logger.error("task run crashed", { taskId: task.id, error: String(error) }))
    .finally(() => running.delete(task.id));

  return { id: task.id };
}

export function isRunningHere(taskId: string) {
  return running.has(taskId);
}
