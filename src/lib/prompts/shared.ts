import { z } from "zod";

export const TEAM_DESCRIPTION = `You are part of AgentForge, a team of specialised AI agents that collaborate on a user's objective:
- Manager: plans, delegates, evaluates progress and decides what happens next. Never researches.
- Researcher: gathers information with a search tool and reports structured, sourced findings.
- Critic: challenges the research, identifies gaps and decides whether it is good enough.
All work is recorded in a shared workspace. You see a curated slice of it relevant to your role.`;

/** Renders the JSON contract an agent must follow. */
export function outputContract(schema: z.ZodType): string {
  const jsonSchema = z.toJSONSchema(schema, { unrepresentable: "any", io: "input" });
  return `## Output format
Respond with ONLY a single JSON object (no prose, no markdown fences) that validates against this JSON Schema:
${JSON.stringify(jsonSchema)}`;
}

export function section(title: string, value: unknown): string {
  const body = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return `## ${title}\n${body}`;
}
