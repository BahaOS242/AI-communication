import type {
  CriticReview,
  FinalSynthesis,
  ManagerDecision,
  ResearchQueries,
  ResearchReport,
} from "../schemas";
import type { CriticView, ManagerView, ResearcherView, SynthesisView } from "../../orchestration/context";
import type { SourcedHit } from "../../agents/researcher";
import { tokenize } from "../../tools/mock-search";
import { approximateTokens } from "../pricing";
import { ProviderError, type AIProvider, type AIRequest, type AIResponse } from "../types";

/**
 * Deterministic scripted "LLM" for DEMO_MODE.
 *
 * It reads the same structured context the real prompt is rendered from and
 * returns JSON text, which then goes through exactly the same parsing, schema
 * validation, guards and state machine as a real model. The script makes
 * genuine decisions from workspace state (e.g. the critic rejects the first
 * round because pricing for the target segment is missing), so the full
 * plan → research → critique → re-research → approve loop is exercised.
 */
export class DemoProvider implements AIProvider {
  readonly name = "demo";
  readonly model = "demo-scripted";

  async complete(request: AIRequest): Promise<AIResponse> {
    const output = this.respond(request);
    const text = JSON.stringify(output);
    return {
      text,
      model: this.model,
      usage: {
        inputTokens: approximateTokens(request.system + request.prompt),
        outputTokens: approximateTokens(text),
      },
    };
  }

  private respond(request: AIRequest): unknown {
    const key = `${request.agent}/${request.purpose}`;
    switch (key) {
      case "manager/decide":
        return managerDecide(request.context as ManagerView);
      case "manager/synthesize":
        return synthesize(request.context as SynthesisView);
      case "researcher/plan_queries":
        return planQueries(request.context as ResearcherView);
      case "researcher/report":
        return report(request.context as ResearcherView & { results: SourcedHit[] });
      case "critic/review":
        return review(request.context as CriticView);
      default:
        throw new ProviderError(`Demo provider has no script for ${key}`, false);
    }
  }
}

const isTouristObjective = (objective: string) => /touris|visitor|travell?er|holiday|vacation/i.test(objective);

// ------------------------------------------------------------------ manager

function managerDecide(view: ManagerView): ManagerDecision {
  if (view.subtasks.length === 0) {
    const subject = view.objective.replace(/\.$/, "");
    return {
      action: "ASSIGN_RESEARCH",
      reason: "No work exists yet. Viability depends on competition, demand from the target customer, and whether pricing covers costs.",
      message:
        "Researcher, to answer this we need three things: who already competes for this customer, whether the target customer actually wants it, and what pricing and costs look like. Please start with these three tasks.",
      tasks: [
        {
          title: "Map the competitive landscape",
          description: `Identify existing providers relevant to: "${subject}". For each, note what they offer, what they charge and who they serve.`,
        },
        {
          title: "Profile target customers and demand",
          description: `Establish who the target customer is for "${subject}", how many of them there are, and evidence that they would buy.`,
        },
        {
          title: "Benchmark pricing and operating economics",
          description: `Find price points, operating costs and seasonality that determine whether "${subject}" can be profitable.`,
        },
      ],
      reviewFocus: null,
    };
  }

  const outstanding = view.latestReview?.decision === "NEEDS_MORE_WORK" ? view.latestReview.outstandingRequests : [];
  if (outstanding.length > 0) {
    return {
      action: "ASSIGN_RESEARCH",
      reason: `The critic identified gaps that would change the answer: ${outstanding.map((o) => o.title).join("; ")}.`,
      message: `Researcher, the critic found gaps in our evidence. Please ${lowerFirst(outstanding[0].title)}${
        outstanding.length > 1 ? `, and also ${lowerFirst(outstanding[1].title)}` : ""
      }.`,
      tasks: outstanding,
      reviewFocus: null,
    };
  }

  if (view.unreviewedFindingCount > 0) {
    return {
      action: "REQUEST_REVIEW",
      reason: `${view.unreviewedFindingCount} finding(s) have not been reviewed. Nothing should reach the user unchallenged.`,
      message: `Critic, the researcher has delivered ${view.unreviewedFindingCount} new finding(s). Please challenge them before we draw conclusions — especially whether the evidence really supports viability.`,
      tasks: [],
      reviewFocus: "Whether the evidence is specific to the target customer, and whether pricing is supported.",
    };
  }

  if (view.latestReview?.decision === "APPROVED") {
    return {
      action: "COMPLETE",
      reason: "The critic approved the findings and no unreviewed work remains. Completion criteria are met.",
      message: "The critic has approved the research. I have what I need — moving to the final synthesis.",
      tasks: [],
      reviewFocus: null,
    };
  }

  return {
    action: "FAIL",
    reason: "No findings could be produced and there is no further research to assign.",
    message: "We could not gather usable evidence for this objective, so I am stopping here.",
    tasks: [],
    reviewFocus: null,
  };
}

// ------------------------------------------------------------------ researcher

function planQueries(view: ResearcherView): ResearchQueries {
  const t = `${view.assignment.title} ${view.assignment.description}`.toLowerCase();
  const subject = tokenize(view.objective)
    .filter((w) => !["determine", "research", "viable", "viability", "focused", "whether"].includes(w))
    .slice(0, 4)
    .join(" ");
  let queries: string[];
  if (/compet/.test(t)) queries = [`${subject} competitor studios landscape`, `${subject} resort hotel spa classes guests`];
  else if (/willing|tourist-specific|tourist pricing|visitor pricing/.test(t))
    queries = [`${subject} tourist pricing willingness to pay package premium`, `${subject} visitor package rates`];
  else if (/book|channel|logistic|timing|reach/.test(t))
    queries = [`${subject} hotel concierge partnership booking commission`, `${subject} cruise passenger port schedule timing`];
  else if (/customer|demand|segment/.test(t))
    queries = [`${subject} target customer segment demand`, `${subject} tourism arrivals cruise stopover demand wellness trend`];
  else if (/pric|econom|cost/.test(t))
    queries = [`${subject} operating costs rent equipment reformer`, `${subject} seasonality peak demand risk`];
  else queries = [`${subject} ${view.assignment.title}`];
  return { queries, rationale: `Queries target the specific question in "${view.assignment.title}".` };
}

function report(view: ResearcherView & { results: SourcedHit[] }): ResearchReport {
  const known = new Set(view.alreadyKnown.map((k) => k.toLowerCase()));
  const placeholder = view.results.every((r) => r.title.includes("No curated demo data"));
  const fresh = view.results.filter((r) => !known.has(cleanTitle(r.title).toLowerCase())).slice(0, 4);
  const useful = fresh.length > 0 ? fresh : view.results.slice(0, 1);

  const findings = useful.map((r) => ({
    title: cleanTitle(r.title),
    content: placeholder
      ? `No curated evidence is available for this assignment in the offline demo dataset. ${r.snippet}`
      : r.snippet,
    confidence: (placeholder ? "low" : "medium") as "low" | "medium",
    sourceIds: [r.id],
  }));

  const uncertainties = ["All figures come from the illustrative demo dataset (fictional businesses) and must be verified with live sources."];
  const t = view.assignment.title.toLowerCase();
  if (/compet/.test(t)) uncertainties.push("The share of competitors' customers who are visitors is not established.");
  if (/pric|econom/.test(t) && !/touris|willing/.test(t))
    uncertainties.push("Price points found are resident-facing studio rates; what visitors would pay is unknown.");
  if (/customer|demand/.test(t)) uncertainties.push("Visitor volume is not the same as demand for this specific activity.");

  return {
    status: "COMPLETED",
    summary: placeholder
      ? `I searched for "${view.assignment.title}" but the demo dataset has no curated material on this topic, so I can only report that the evidence is missing.`
      : `For "${view.assignment.title}" I found ${findings.length} relevant item(s): ${findings.map((f) => f.title).join("; ")}.`,
    findings,
    uncertainties,
    blockedReason: null,
  };
}

const cleanTitle = (t: string) => t.replace(/^\[Demo data\]\s*/, "");

// ------------------------------------------------------------------ critic

function review(view: CriticView): CriticReview {
  if (view.reviewRound === 1 && view.iterationsRemaining > 2) {
    if (isTouristObjective(view.objective)) {
      return {
        decision: "NEEDS_MORE_WORK",
        summary:
          "The research covers competitors, visitor volume and costs, but it does not establish what tourists would actually pay. Every price point we have is a resident studio rate, so viability cannot be judged yet.",
        issues: [
          {
            type: "MISSING_INFORMATION",
            description: "Pricing evidence (e.g. $45 drop-ins, $380 class packs) reflects resident rates. Nothing shows tourist-specific pricing or willingness to pay.",
            severity: "high",
          },
          {
            type: "UNSUPPORTED_ASSUMPTION",
            description: "Large visitor numbers are treated as demand, but most arrivals are cruise passengers with short port windows who may not book a class.",
            severity: "medium",
          },
        ],
        requestedResearch: [
          {
            title: "Investigate tourist-specific pricing and willingness to pay",
            description: "Find what visitors pay for comparable fitness or wellness activities and whether they accept a premium for a packaged experience.",
          },
          {
            title: "Assess how visitors would discover and book classes",
            description: "Identify booking channels (hotels, platforms), their commissions, and timing constraints for cruise vs stopover visitors.",
          },
        ],
      };
    }
    return {
      decision: "NEEDS_MORE_WORK",
      summary: "The findings are generic and not specific to the target customer. We need evidence that speaks directly to the objective before concluding.",
      issues: [
        {
          type: "WEAK_EVIDENCE",
          description: "Most findings are placeholders or general context rather than evidence about the target segment.",
          severity: "high",
        },
      ],
      requestedResearch: [
        {
          title: "Find segment-specific evidence for the objective",
          description: `Look for direct evidence on customers, pricing and competitors for: "${view.objective}".`,
        },
      ],
    };
  }

  return {
    decision: "APPROVED",
    summary:
      "The follow-up research addresses the gaps I raised: we now have visitor-facing price benchmarks and a realistic picture of how visitors book. Remaining uncertainty is about data quality, not missing questions. Approved.",
    issues: [
      {
        type: "WEAK_EVIDENCE",
        description: "All evidence is illustrative demo data; conclusions are directional until verified with live sources.",
        severity: "low",
      },
    ],
    requestedResearch: [],
  };
}

// ------------------------------------------------------------------ synthesis

function synthesize(view: SynthesisView): FinalSynthesis {
  const findings = view.findings.filter((f) => f.confidence !== "low");
  const top = (findings.length ? findings : view.findings).slice(0, 7);
  const keyFindings = top.map((f) => ({ title: f.title, detail: f.content, sourceIds: f.sourceIds }));
  const uncertainties = [...new Set(view.uncertainties)].slice(0, 6);
  const nassauPilates = /pilates/i.test(view.objective) && /nassau|bahamas/i.test(view.objective);

  if (nassauPilates) {
    return {
      summary:
        "A tourist-focused Pilates package in Nassau looks conditionally viable. Existing studios serve residents and resort classes are guest-only, leaving a gap for a bookable visitor experience. Stopover visitors — not cruise passengers — are the realistic market, and visitor-facing price benchmarks ($40–70 drop-in, $150–180 bundles) sit well above resident rates. All figures come from the illustrative demo dataset and must be verified before any decision.",
      keyFindings,
      uncertainties,
      recommendations: [
        "Target stopover visitors through partnerships with boutique hotels that lack their own fitness programming.",
        "Pilot a 3-class visitor bundle priced around $150–180, and test willingness to pay before committing capital.",
        "Start with a mat or pop-up format (hotel rooftops, beach) to limit equipment and rent costs during validation.",
        "Keep a resident-facing offer to protect revenue during the June–November off-season.",
        "Replace demo-dataset figures with live market data and a small visitor survey before investing.",
      ],
      conclusion:
        "Proceed to a low-cost pilot aimed at stopover visitors via hotel partnerships; do not build a reformer studio until visitor demand and pricing are validated.",
      confidence: "medium",
    };
  }

  return {
    summary: `The team investigated "${view.objective}" across ${view.findings.length} finding(s). ${
      view.usesDemoData
        ? "This run used the offline demo dataset, which has little or no curated material on this topic, so the conclusions below are placeholders that demonstrate the workflow rather than a real answer."
        : "See key findings and uncertainties below."
    }`,
    keyFindings: keyFindings.length
      ? keyFindings
      : [{ title: "No substantive evidence", detail: "The search tool returned no usable evidence.", sourceIds: [] }],
    uncertainties: uncertainties.length ? uncertainties : ["Evidence base is thin."],
    recommendations: [
      "Configure a live search API (TAVILY_API_KEY or BRAVE_SEARCH_API_KEY) and a real AI provider, then re-run this objective.",
      "Narrow the objective to a specific customer, place and decision to get sharper research tasks.",
    ],
    conclusion: "Insufficient evidence for a confident conclusion in demo mode.",
    confidence: "low",
  };
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
