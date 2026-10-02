import type { AgentName } from "../domain";

/**
 * Agent metadata used by the UI and documentation. Adding a new agent means:
 * 1. add its name to AGENT_NAMES in domain.ts,
 * 2. give it a schema, prompt and run function,
 * 3. teach the manager about it (a new action) and the engine how to dispatch it.
 */
export const AGENTS: Record<AgentName, { label: string; role: string; capabilities: string[] }> = {
  manager: {
    label: "Manager",
    role: "Plans, delegates, evaluates progress and decides when the work is done.",
    capabilities: ["ASSIGN_RESEARCH", "REQUEST_REVIEW", "COMPLETE", "FAIL", "synthesize"],
  },
  researcher: {
    label: "Researcher",
    role: "Gathers sourced findings with the search tool and reports uncertainty.",
    capabilities: ["web_search"],
  },
  critic: {
    label: "Critic",
    role: "Challenges findings and approves or requests more work.",
    capabilities: ["APPROVED", "NEEDS_MORE_WORK"],
  },
};
