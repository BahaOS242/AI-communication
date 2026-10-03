# AgentForge

**Give your AI team a task.**

AgentForge is a multi-agent system. You give it a complex objective, and three specialised agents (a **Manager**, a **Researcher** and a **Critic**) work on it together. The manager plans and delegates, the researcher gathers sourced evidence with a search tool, and the critic challenges the work. The manager reads each result and decides what happens next, and the loop repeats until the critic approves and the completion criteria are met. You can watch the whole process live.

```
User:       "Determine whether a tourist-focused Pilates package would be viable in Nassau."
Manager:    "We need competitors, target customers and pricing."         → ASSIGN_RESEARCH ×3
Researcher: "Two resident-focused studios, resort classes are guest-only…"
Critic:     "Every price point is a resident rate. Tourist pricing is missing." → NEEDS_MORE_WORK
Manager:    "Researcher, investigate tourist-specific pricing."           → ASSIGN_RESEARCH
Researcher: "Visitor bundles benchmark at $150–180…"
Critic:     "Gaps addressed."                                             → APPROVED
Manager:    "Completion criteria met."                                    → COMPLETE → final synthesis
```

None of those steps is hard-coded. The demo above comes from the deterministic demo provider (see [Demo mode](#demo-mode)). It goes through the same engine, schemas and guards a real LLM uses.

---

## Why this isn't just a chatbot

A chatbot maps one prompt to one answer. AgentForge is a small autonomous system:

| Property | How AgentForge does it |
|---|---|
| **Multiple autonomous agents** | Three agents with separate prompts, responsibilities and output contracts. The manager never researches, and the critic never writes the answer. |
| **State-driven orchestration** | The manager picks the next action from the workspace state each iteration. The order manager → researcher → critic → … emerges at runtime instead of being written into the code. |
| **Structured state transitions** | An explicit state machine (`PENDING → PLANNING → RESEARCHING → REVIEWING → NEEDS_MORE_WORK → … → COMPLETED`). Invalid transitions throw. |
| **Structured outputs only** | Every LLM response is JSON validated with Zod. Application state never comes from parsing prose. |
| **Tool use** | The researcher plans queries, calls a search tool, and may only cite results that tool actually returned. Hallucinated source ids are removed. |
| **Persistent shared workspace** | Postgres holds the objective, subtasks, findings, evidence, decisions, messages and events. It is the single source of truth. |
| **Review loops** | The critic can send work back. The manager turns its requests into new assignments, and the critic re-reviews only what changed. |
| **Explicit completion criteria** | The engine rejects `COMPLETE` unless the critic's latest verdict is `APPROVED` and no unreviewed findings exist. |
| **Safety limits** | Caps on iterations, agent calls, retries, per-call timeout, task timeout, consecutive failures and rejected actions. If the task stops early, the user still gets the work done so far. |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│ UI  (Next.js App Router, React, Tailwind)                                │
│   /             TaskInput, recent tasks                                  │
│   /task/[id]    AgentRoster · AgentActivity · AgentConversation ·        │
│                 WorkspacePanel · FinalResult · TaskTimeline              │
└───────────────▲──────────────────────────────────────┬───────────────────┘
                │ SSE snapshots (/api/tasks/:id/stream) │ POST /api/tasks
┌───────────────┴──────────────────────────────────────▼───────────────────┐
│ API routes  (src/app/api)          service.ts: create task, run engine   │
└──────────────────────────────────────┬───────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼───────────────────────────────────┐
│ Orchestration  (src/lib/orchestration)                                   │
│   engine.ts         loop · limits · agent-run observability · events     │
│   state-machine.ts  transitions · completion criteria · manager guard    │
│   context.ts        per-agent views of the workspace (selective memory)  │
│   report.ts         final / partial result assembly                      │
│   repository.ts     persistence port (Prisma impl + in-memory impl)      │
└──────┬─────────────────────────┬───────────────────────────┬─────────────┘
       │                         │                           │
┌──────▼────────────┐  ┌─────────▼──────────┐  ┌─────────────▼─────────────┐
│ Agents            │  │ AI provider layer  │  │ Tools                     │
│  manager.ts       │─▶│  provider.ts       │  │  search.ts  Tavily/Brave  │
│  researcher.ts ───┼──┼──────────────────▶ │  │  mock-search.ts (demo)    │
│  critic.ts        │  │  structured.ts     │  └───────────────────────────┘
│ prompts/*.ts      │  │   JSON → Zod →     │
└───────────────────┘  │   retry/timeout    │
                       │  providers/        │
                       │   anthropic.ts     │
                       │   openai.ts        │
                       │   demo.ts          │
                       └────────────────────┘
┌──────────────────────────────────────────────────────────────────────────┐
│ Database  (PostgreSQL via Prisma 7)                                      │
│   User · Task · Subtask · AgentRun · AgentMessage · Finding · Evidence · │
│   Decision · TaskEvent                                                   │
└──────────────────────────────────────────────────────────────────────────┘
```

The layers are separated on purpose:

- The engine has no dependency on React, Next.js or Prisma. It talks to a `TaskRepository` interface, an `AIProvider` interface and a `SearchTool` interface. The integration tests run it fully in memory.
- Agents are pure functions of their dependencies and a workspace view. They never touch the database.
- Providers only turn a request into text. JSON extraction, schema validation, retries, timeouts and cost accounting live in one place (`structured.ts`), so they behave the same for every vendor.

### Project layout

```
prisma/schema.prisma            data model
src/app/                        pages + API routes
src/components/                 UI components
src/lib/domain.ts               core types (statuses, agents, records)
src/lib/ai/                     provider abstraction, schemas, structured output
src/lib/agents/                 manager, researcher, critic
src/lib/prompts/                one system prompt per agent
src/lib/orchestration/          engine, state machine, context, repository
src/lib/tools/                  search tool abstraction + implementations
src/lib/db/                     Prisma client + repository
src/lib/observability/          structured logger with secret redaction
tests/unit, tests/integration   Vitest suites
```

---

## Agent responsibilities

| Agent | Does | Never does | Output schema |
|---|---|---|---|
| **Manager** | Breaks the objective into research tasks, delegates them, reads results and critiques, chooses the next action, decides when the work is done, writes the final synthesis. | Research. | `ManagerDecision`: `{ action: ASSIGN_RESEARCH \| REQUEST_REVIEW \| COMPLETE \| FAIL, reason, message, tasks[], reviewFocus }`, then `FinalSynthesis` |
| **Researcher** | Handles one assignment at a time: plans 1–3 queries → calls the search tool → reports findings that cite result ids, states uncertainties, or reports `BLOCKED`. | Decide what the team does next. | `ResearchQueries`, then `ResearchReport`: `{ status: COMPLETED \| BLOCKED, summary, findings[{title, content, confidence, sourceIds}], uncertainties[], blockedReason }` |
| **Critic** | Looks for unsupported assumptions, missing information, contradictions and weak evidence. Either approves or requests specific follow-up research. | Do the research, or write the answer. | `CriticReview`: `{ decision: APPROVED \| NEEDS_MORE_WORK, summary, issues[{type, description, severity}], requestedResearch[] }` |

Each schema includes cross-field rules. For example, `ASSIGN_RESEARCH` needs at least one task, `NEEDS_MORE_WORK` must say what is missing, and `BLOCKED` needs a reason.

---

## The orchestration loop

```
             ┌────────────────────────────────────────────────────────────┐
             ▼                                                            │
  check limits ──► iteration++ ──► PLANNING: manager decides (validated)  │
                                        │                                 │
                     guard: is the action valid in this state?            │
                     ├─ no  → REJECTED_ACTION message → manager retries ──┤
                     ▼                                                    │
   ASSIGN_RESEARCH ─► RESEARCHING: researcher runs each subtask ──────────┤
   REQUEST_REVIEW ──► REVIEWING: critic ─┬─ APPROVED ─────────────────────┤
                                         └─ NEEDS_MORE_WORK ──────────────┘
   COMPLETE ────────► SYNTHESIZING: manager writes final result ─► COMPLETED
   FAIL ────────────► FAILED (partial result)
   any limit hit ───► FAILED_REQUIRES_REVIEW (partial result)
```

The **manager guard** (`validateManagerAction`) is where completion criteria are enforced:

- `COMPLETE` is rejected unless the latest critic review is `APPROVED` and no findings were added after it.
- `REQUEST_REVIEW` is rejected if there are no unreviewed findings.
- `ASSIGN_RESEARCH` is rejected if every task duplicates completed research.

A rejected action does not crash the task. The reason goes back into the manager's next prompt, and the manager chooses again. After repeated rejections the task stops.

### Agent communication and shared memory

Agents communicate through structured `AgentMessage` records, which are validated by `AgentMessageSchema` before they are saved:

```json
{
  "taskId": "cm…",
  "fromAgent": "critic",
  "toAgent": "manager",
  "type": "NEEDS_MORE_WORK",
  "content": "The research does not establish what tourists would actually pay…",
  "reason": "[high] Pricing evidence reflects resident rates…",
  "metadata": { "reviewedFindingIds": ["…"], "issues": [], "requestedResearch": [] },
  "createdAt": "2026-10-02T13:34:16.000Z"
}
```

Agents do **not** receive the whole transcript. `context.ts` builds a role-specific view of the workspace:

- **Manager:** subtask statuses, finding titles and summaries (reviewed or not), open uncertainties, the latest review with outstanding requests, the last few messages, the remaining budget, and any rejected action.
- **Researcher:** the objective, its single assignment, the critic's concerns if the critic asked for this work, and the titles of what the team already knows (so it doesn't repeat work).
- **Critic:** all findings with their evidence snippets, which findings are new since its last review, its own previous reviews, and the remaining budget.

---

## Safety and loop protection

| Protection | Default | Env var |
|---|---|---|
| Max manager iterations | 10 | `MAX_ITERATIONS` |
| Max agent calls per task | 30 | `MAX_AGENT_CALLS` |
| Retries per LLM call (malformed JSON, schema violation, 429/5xx/timeout) | 2 | `MAX_RETRIES` |
| Per-LLM-call timeout | 120 s | `AGENT_TIMEOUT_MS` |
| Whole-task timeout (also aborts in-flight calls) | 15 min | `TASK_TIMEOUT_MS` |
| Consecutive failed agent runs | 3 | — |
| Consecutive rejected manager actions | 3 | — |

When a limit is hit, the task moves to `FAILED_REQUIRES_REVIEW`. The user then gets a **partial result** assembled without any LLM call (so it can't fail) from every finding, source, open critic issue and research request that was never addressed.

Other safeguards:

- **Malformed responses.** Invalid JSON or schema errors are sent back to the model ("your previous response was rejected because …") and retried.
- **Failed agents.** A failure is recorded on the AgentRun, the subtask is marked `FAILED`, and the manager receives an `AGENT_FAILED` message and can work around it.
- **Grounding.** Citations to source ids that the search tool never returned are dropped, and the finding's confidence is lowered to `low`.
- **Cost tracking.** Tokens from every attempt, including failed ones, are added to the AgentRun and the Task, and priced per model (`src/lib/ai/pricing.ts`).

---

## Database architecture

The database lets you reconstruct a task exactly as it happened.

| Model | Purpose |
|---|---|
| `User` | Owner of tasks (single demo user for now; ready for multi-user). |
| `Task` | Objective, status, current step, iteration, agent call count, token and cost totals, final result (JSON), error. |
| `Subtask` | A research assignment: who it is assigned to, who caused it (`manager` or `critic`), status. |
| `AgentRun` | One agent invocation: input (the workspace view it saw), validated output, error, attempts, tokens, cost, model, duration. |
| `AgentMessage` | Structured communication between agents. |
| `Finding` | A `FINDING` or `UNCERTAINTY`, linked to its subtask and agent run. |
| `Evidence` | A source backing a finding: source id, title, URL, snippet, tool, and `isMock`. |
| `Decision` | Every manager decision and whether the engine accepted it. |
| `TaskEvent` | Append-only event log with a per-task sequence number (`TASK_CREATED`, `MANAGER_PLANNED`, `AGENT_STARTED`, `TOOL_CALLED`, `CRITIC_REQUESTED_MORE_WORK`, `MANAGER_REASSIGNED_TASK`, `LIMIT_REACHED`, `TASK_COMPLETED`, …). |

### Real-time updates

`GET /api/tasks/:id/stream` is a Server-Sent Events endpoint. It watches the task in Postgres and pushes a full snapshot whenever something changes. Because the database stays the source of truth, there is no in-memory pub/sub to drift out of sync. If the stream errors, the client falls back to polling.

---

## Tool system

`SearchTool` (`src/lib/tools/types.ts`) is the only thing agents depend on:

```ts
interface SearchTool {
  name: string;
  isMock: boolean;
  search(query: string, options?): Promise<SearchHit[]>;
}
```

Implementations:

- `TavilySearchTool`, used when `TAVILY_API_KEY` is set
- `BraveSearchTool`, used when `BRAVE_SEARCH_API_KEY` is set
- `MockSearchTool`: a deterministic offline dataset. Every result is labelled `[Demo data]`, has no URL, and describes **fictional** businesses with **illustrative** figures. For topics outside the dataset it returns an honest "no curated demo data" placeholder rather than making something up.

## AI providers

`AIProvider` has one method, `complete(request) → { text, usage, model }`.

- `AnthropicProvider` uses the official `@anthropic-ai/sdk`. It defaults to `claude-opus-5-5` and requests native structured outputs (`output_config.format`). If the API rejects a schema, it falls back to prompt-only JSON, which is still validated centrally. `refusal` stop reasons are handled.
- `OpenAIProvider` uses Chat Completions in JSON mode, through `fetch`.
- `DemoProvider` is the deterministic scripted provider for demo mode.

To add Google or another vendor, implement `AIProvider` and add a case in `src/lib/ai/provider.ts`. API keys are read only on the server and are never sent to the browser. The logger redacts key-like fields and values.

---

## Running locally

Requirements: Node 20+ and PostgreSQL 14+.

```bash
npm install                       # also runs `prisma generate`
cp .env.example .env              # DEMO_MODE=true by default
# point DATABASE_URL at your Postgres, e.g. postgresql://postgres:postgres@localhost:5432/agentforge
npm run db:deploy                 # apply migrations
npm run dev                       # http://localhost:3000
```

Production build: `npm run build && npm start`.

### Running with a real model

```bash
# .env
DEMO_MODE=false
ANTHROPIC_API_KEY=sk-ant-...      # or AI_PROVIDER=openai + OPENAI_API_KEY
TAVILY_API_KEY=tvly-...           # optional: live web search (otherwise the labelled demo dataset)
```

### Headless runner

You can run a task from the terminal and watch the agent conversation print live. This is handy for debugging prompts against a real model:

```bash
npm run task -- "Determine whether a tourist-focused Pilates package would be viable in Nassau."
npm run task -- --memory "..."   # keep everything in memory instead of Postgres
```

At the end it prints the final (or partial) result, plus iterations, agent calls, token usage, estimated cost and elapsed time. It exits `0` if the task completed and `2` if it stopped early.

For Claude Code cloud sessions, `.claude/hooks/session-start.sh` installs dependencies, starts a local Postgres, applies the migrations and exports `DATABASE_URL`.

> Tasks run in the background inside the Next.js server process, which works for `next dev` and `next start`. Serverless deployments would need a job queue (see Future improvements).

## Environment variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | Postgres connection string (required). |
| `DEMO_MODE` | `true` runs the scripted provider and the offline dataset. No keys needed. |
| `DEMO_STEP_DELAY_MS` | Pause between demo agent steps so the live view is easy to follow (default 900). |
| `AI_PROVIDER` | `anthropic` \| `openai`. If unset, it is inferred from whichever key is present. |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_EFFORT` | Anthropic settings (model default `claude-opus-5-5`, effort default `medium`). |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | OpenAI settings. |
| `TAVILY_API_KEY` / `BRAVE_SEARCH_API_KEY` | Live web search. Without either, the labelled demo dataset is used. |
| `MAX_ITERATIONS`, `MAX_AGENT_CALLS`, `MAX_RETRIES`, `AGENT_TIMEOUT_MS`, `TASK_TIMEOUT_MS` | Loop protection. |
| `LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error`. |

## Demo mode

With `DEMO_MODE=true`, AgentForge runs completely offline and deterministically:

- The **DemoProvider** reads the same structured context a real model's prompt is built from, and returns JSON text. That text goes through the same JSON extraction, Zod validation, guards and state machine as real model output, so the full engine is exercised.
- The script makes its decisions from workspace state. The critic rejects the first round because the evidence doesn't cover tourist pricing, the manager turns that into new assignments, and the critic approves the second round.
- The **MockSearchTool** supplies evidence that is clearly labelled as illustrative and fictional. The UI shows a "Demo mode" badge, and the final result warns that the evidence did not come from the live web.

## Testing

```bash
npm run typecheck
npm run lint
npm test                  # all suites
npm run test:unit
npm run test:integration  # Postgres suite runs when DATABASE_URL is set, otherwise skipped
npm run build
```

| Suite | Covers |
|---|---|
| `unit/state-machine` | Valid and invalid transitions, terminal states, unreviewed findings, outstanding critic requests, completion criteria and the manager guard. |
| `unit/schemas` | Every agent output schema and its cross-field rules; agent message validation. |
| `unit/structured` | JSON extraction, retry-with-feedback, retry limits, retryable vs non-retryable errors, timeouts, usage and cost accumulation. |
| `unit/anthropic-provider` | The real Anthropic SDK request path against a local fake API: headers, model, effort, native JSON schema for every agent schema, usage and cost parsing, fallback when a schema is rejected, mapping of 429/401 errors, refusals. |
| `unit/tools-and-logging` | Determinism and labelling of the demo dataset, provider and tool selection from env, secret redaction. |
| `integration/engine` | manager → researcher → critic → complete; manager → researcher → critic → researcher → critic → manager; the full demo loop; malformed responses (recovered and unrecoverable); `MAX_ITERATIONS`; `MAX_AGENT_CALLS`; agent failure; premature `COMPLETE` rejection; repeated invalid actions; per-call and whole-task timeouts; hallucinated citations; blocked research. |
| `integration/prisma-repository` | The full loop against real Postgres, with a reconstructable history (contiguous event sequence, one decision per iteration). |

## Future improvements

The code is structured so these can be added without changing the core loop:

- **More agents** (browser, code execution, financial or data analyst, email, Slack). Add the name to `AGENT_NAMES`, give it a schema, prompt and run function, and add a manager action plus an engine dispatch case.
- **MCP tools.** Implement them behind the tool interfaces in `src/lib/tools`.
- **Human approval steps.** Add a `WAITING_FOR_HUMAN` state to the state machine plus a resume endpoint. The engine already resumes from persisted counters.
- **Scheduled and long-running tasks.** Replace the in-process `void engine.run()` in `service.ts` with a job queue worker.
- **Agent memory across tasks.** Add a repository-backed memory store that feeds into the `context.ts` views.
- **Multi-user organisations.** `User` already owns tasks; add auth and an `Organization` model.
- **Usage and cost dashboards.** Per-run tokens and cost are already stored on `AgentRun` and `Task`.
