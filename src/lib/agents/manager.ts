import { generateStructured } from "../ai/structured";
import {
  FinalSynthesisSchema,
  ManagerDecisionSchema,
  type FinalSynthesis,
  type ManagerDecision,
} from "../ai/schemas";
import type { ManagerView, SynthesisView } from "../orchestration/context";
import {
  MANAGER_DECIDE_SYSTEM,
  MANAGER_SYNTHESIZE_SYSTEM,
  managerDecidePrompt,
  managerSynthesizePrompt,
} from "../prompts/manager";
import type { AgentDeps, AgentResult } from "./types";

/** Manager: chooses the next orchestration action from the current workspace. */
export async function managerDecide(deps: AgentDeps, view: ManagerView): Promise<AgentResult<ManagerDecision>> {
  const result = await generateStructured(
    deps.provider,
    {
      agent: "manager",
      purpose: "decide",
      system: MANAGER_DECIDE_SYSTEM,
      prompt: managerDecidePrompt(view),
      schema: ManagerDecisionSchema,
      schemaName: "ManagerDecision",
      maxTokens: 8000,
      signal: deps.signal,
      context: view,
    },
    {
      maxRetries: deps.maxRetries,
      timeoutMs: deps.timeoutMs,
      onRetry: (i) => deps.onRetry?.({ purpose: "decide", ...i }),
    },
  );
  return { output: result.data, usage: result.usage, costUsd: result.costUsd, attempts: result.attempts, model: result.model };
}

/** Manager: writes the final deliverable from approved findings. */
export async function managerSynthesize(
  deps: AgentDeps,
  view: SynthesisView,
): Promise<AgentResult<FinalSynthesis>> {
  const result = await generateStructured(
    deps.provider,
    {
      agent: "manager",
      purpose: "synthesize",
      system: MANAGER_SYNTHESIZE_SYSTEM,
      prompt: managerSynthesizePrompt(view),
      schema: FinalSynthesisSchema,
      schemaName: "FinalSynthesis",
      maxTokens: 12000,
      signal: deps.signal,
      context: view,
    },
    {
      maxRetries: deps.maxRetries,
      timeoutMs: deps.timeoutMs,
      onRetry: (i) => deps.onRetry?.({ purpose: "synthesize", ...i }),
    },
  );
  return { output: result.data, usage: result.usage, costUsd: result.costUsd, attempts: result.attempts, model: result.model };
}
