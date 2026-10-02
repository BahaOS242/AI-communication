import { FinalSynthesisSchema, ManagerDecisionSchema } from "../ai/schemas";
import type { ManagerView, SynthesisView } from "../orchestration/context";
import { outputContract, section, TEAM_DESCRIPTION } from "./shared";

export const MANAGER_DECIDE_SYSTEM = `${TEAM_DESCRIPTION}

You are the MANAGER. You coordinate; you do not do the research yourself.

Each turn you look at the workspace and choose exactly one action:
- ASSIGN_RESEARCH: delegate 1-4 clearly scoped research tasks to the Researcher. Use this to create the initial plan, and to act on gaps the Critic identified. Each task must say precisely what to find and why it matters for the objective.
- REQUEST_REVIEW: send the current findings to the Critic. Do this once there are unreviewed findings.
- COMPLETE: finish and move to final synthesis. Only valid when the Critic has APPROVED and no unreviewed findings remain.
- FAIL: stop because the objective is impossible or unsafe to pursue. Use sparingly.

Rules:
- Break the objective into the few questions that actually determine the answer; do not over-plan.
- When the Critic returns NEEDS_MORE_WORK, translate its requested research into concrete assignments.
- Do not re-assign research that is already completed.
- Respect the budget: if iterations are running low, prioritise the most important remaining gap.
- If your previous action was rejected by the engine, read the reason and choose a valid action.
- "message" is what you say to the team; write it naturally and address the agent you are delegating to.`;

export function managerDecidePrompt(view: ManagerView): string {
  return [
    section("Objective", view.objective),
    section("Budget", {
      iteration: view.iteration,
      maxIterations: view.maxIterations,
      agentCallsRemaining: view.agentCallsRemaining,
    }),
    section("Subtasks so far", view.subtasks.length ? view.subtasks : "None yet. You need to plan."),
    section("Findings in the workspace", view.findings.length ? view.findings : "None yet."),
    section("Open uncertainties reported by the researcher", view.openUncertainties),
    section("Unreviewed findings", view.unreviewedFindingCount),
    section("Latest critic review", view.latestReview ?? "No review yet."),
    section("Recent team messages", view.recentMessages),
    ...(view.rejectedAction ? [section("Your previous action was REJECTED by the engine", view.rejectedAction)] : []),
    outputContract(ManagerDecisionSchema),
  ].join("\n\n");
}

export const MANAGER_SYNTHESIZE_SYSTEM = `${TEAM_DESCRIPTION}

You are the MANAGER writing the final deliverable. The Critic has approved the research.

Rules:
- Use ONLY the findings provided. Do not introduce new facts.
- Cite source ids (e.g. "S3") from the provided sources in keyFindings.sourceIds.
- Carry forward genuine uncertainties; do not overstate confidence.
- If the sources are demo data, say clearly that figures are illustrative and must be verified.
- Recommendations must follow from the findings and be actionable.`;

export function managerSynthesizePrompt(view: SynthesisView): string {
  return [
    section("Objective", view.objective),
    section("Approved findings", view.findings),
    section("Sources", view.sources),
    section("Uncertainties", view.uncertainties),
    section("Critic's final assessment", view.criticAssessment ?? "n/a"),
    section("Data provenance", view.usesDemoData ? "Some or all sources are from the offline DEMO dataset (illustrative, fictional)." : "Live web search results."),
    outputContract(FinalSynthesisSchema),
  ].join("\n\n");
}
