import type { SearchHit, SearchOptions, SearchTool } from "./types";

/**
 * Deterministic, offline search used in DEMO_MODE (or when no search API key is set).
 *
 * Every result is explicitly labelled as demo data: businesses are fictional and
 * figures are illustrative. Nothing here pretends to come from the live web.
 */
const DEMO_SOURCE = "AgentForge demo dataset (illustrative, not live web data)";

interface CorpusEntry {
  keywords: string[];
  title: string;
  snippet: string;
}

const CORPUS: CorpusEntry[] = [
  {
    keywords: ["competitor", "competitors", "studio", "studios", "pilates", "reformer", "landscape", "nassau", "existing"],
    title: "Harbourline Reformer Studio (fictional) — Cable Beach",
    snippet:
      "Illustrative competitor profile: boutique reformer studio, 8 machines, drop-in class $45, 10-class pack $380. Schedule is built around residents' commutes (6am, 12pm, 6pm). No visitor-specific packages; online booking available.",
  },
  {
    keywords: ["competitor", "competitors", "studio", "studios", "pilates", "mat", "downtown", "nassau", "landscape"],
    title: "Coral Core Pilates (fictional) — Downtown Nassau",
    snippet:
      "Illustrative competitor profile: mat and small-group reformer classes. Mat drop-in $30, private session $95. Recently trialled a referral arrangement with one boutique hotel; owner reports 'a handful' of visitor bookings per week in high season.",
  },
  {
    keywords: ["resort", "hotel", "spa", "competitor", "competitors", "guests", "paradise", "island", "wellness", "pilates"],
    title: "Large resort spa programmes (illustrative composite)",
    snippet:
      "Illustrative composite of major resort spas: in-house yoga and Pilates classes are offered to registered guests only, typically $35–60 per group class. Classes are mat-based; reformer equipment is rare. Non-guests generally cannot book.",
  },
  {
    keywords: ["tourist", "tourists", "visitor", "visitors", "demand", "arrivals", "tourism", "cruise", "stopover", "nassau", "market"],
    title: "Visitor mix: cruise vs stopover arrivals (illustrative)",
    snippet:
      "Illustrative tourism profile: Nassau/Paradise Island receives millions of visitors per year, the majority arriving by cruise ship with port calls of roughly 8–10 hours. Stopover (hotel) visitors are fewer but stay an average of about 5–7 nights and have far more schedule flexibility.",
  },
  {
    keywords: ["wellness", "trend", "trends", "tourism", "demand", "fitness", "travel", "travellers", "customer", "growth"],
    title: "Wellness travel trend summary (illustrative)",
    snippet:
      "Illustrative industry summary: 'wellness travellers' spend materially more per trip than average leisure travellers and increasingly look to maintain workout routines while on holiday. Boutique fitness classes are a common add-on activity rather than a primary trip motivator.",
  },
  {
    keywords: ["target", "customer", "customers", "segment", "profile", "demographic", "who", "audience", "demand", "tourist"],
    title: "Target visitor segment sketch (illustrative)",
    snippet:
      "Illustrative segment: women aged 28–50 from the US Northeast and Canada, higher household income, already practising Pilates at home. Tend to book activities before arrival through hotel concierges or online marketplaces, and value convenience (pickup, towels, equipment provided).",
  },
  {
    keywords: ["pricing", "price", "prices", "tourist", "tourists", "visitor", "willingness", "pay", "package", "packages", "rate", "rates"],
    title: "Tourist activity pricing benchmarks (illustrative)",
    snippet:
      "Illustrative benchmarks: guided excursions in Nassau commonly sell for $60–150 per person. Boutique fitness classes aimed at visitors in comparable Caribbean destinations price drop-ins at $40–70, with 3-class visitor bundles around $150–180. Visitors appear less price-sensitive than residents for short bundles.",
  },
  {
    keywords: ["pricing", "price", "willingness", "pay", "tourist", "tourists", "survey", "package", "premium"],
    title: "Visitor willingness-to-pay signals (illustrative)",
    snippet:
      "Illustrative signal: in hypothetical visitor surveys, respondents interested in fitness activities indicate willingness to pay a 20–40% premium over home-city class prices when the package includes transport or an ocean-view setting. Small sample; treat as directional only.",
  },
  {
    keywords: ["cruise", "passenger", "passengers", "port", "schedule", "timing", "excursion", "logistics"],
    title: "Cruise passenger constraints (illustrative)",
    snippet:
      "Illustrative constraint: cruise passengers have limited on-shore windows and favour activities within a short walk or shuttle of the port. Activities over 90 minutes or requiring advance equipment fitting see lower uptake from this group.",
  },
  {
    keywords: ["cost", "costs", "operating", "rent", "equipment", "reformer", "startup", "economics", "margin", "viable", "viability"],
    title: "Operating cost assumptions (illustrative)",
    snippet:
      "Illustrative costs: imported reformer machines roughly $3,000–5,000 each before shipping and import duties; prime commercial rent near tourist areas is significantly higher than in residential areas. Mat-based or pop-up formats (hotel rooftops, beach) reduce capital outlay.",
  },
  {
    keywords: ["season", "seasonality", "hurricane", "peak", "demand", "winter", "tourism", "risk", "risks"],
    title: "Seasonality pattern (illustrative)",
    snippet:
      "Illustrative seasonality: visitor numbers peak from December to April; June–November (hurricane season) is materially quieter. A visitor-dependent business should plan for uneven monthly revenue or a resident-facing base.",
  },
  {
    keywords: ["partnership", "partnerships", "hotel", "hotels", "concierge", "distribution", "channel", "commission", "booking"],
    title: "Distribution through hotels and booking platforms (illustrative)",
    snippet:
      "Illustrative channel economics: hotel concierges and online activity marketplaces typically take a 10–25% commission. Partnerships with boutique hotels lacking their own fitness programming are the most common route to reach stopover visitors.",
  },
  {
    keywords: ["regulation", "regulatory", "licence", "license", "permit", "permits", "legal", "instructor", "instructors", "work"],
    title: "Licensing and staffing considerations (illustrative)",
    snippet:
      "Illustrative note: operating a fitness business typically requires a local business licence; hiring non-resident instructors may require work permits. Beach or public-space classes may need additional permission.",
  },
];

/** The curated dataset only covers this scenario; other topics get honest placeholders. */
const DOMAIN_TERMS = new Set(["pilates", "nassau", "bahamas", "bahamian", "paradise", "reformer", "fitness", "wellness", "yoga"]);

const STOPWORDS = new Set(
  "a an and are as at be by for from how in is it of on or that the this to what whether which who will with would should could into about".split(" "),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

export class MockSearchTool implements SearchTool {
  readonly name = "demo-dataset";
  readonly isMock = true;

  async search(query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
    const max = options.maxResults ?? 4;
    const terms = new Set(tokenize(query));
    const inDomain = [...terms].some((t) => DOMAIN_TERMS.has(t));
    const scored = CORPUS.map((entry, index) => ({
      entry,
      index,
      score: entry.keywords.reduce((s, k) => s + (terms.has(k) ? 1 : 0), 0),
    }))
      .filter((s) => inDomain && s.score >= 2)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, max);

    if (scored.length > 0) {
      return scored.map(({ entry }) => ({
        title: `[Demo data] ${entry.title}`,
        url: null,
        snippet: entry.snippet,
        source: DEMO_SOURCE,
      }));
    }

    // Nothing curated matches: return honest placeholders instead of inventing facts.
    const topic = [...terms].slice(0, 6).join(" ") || query;
    return [
      {
        title: `[Demo data] No curated demo data for "${topic}"`,
        url: null,
        snippet:
          `The offline demo dataset has no material on "${topic}". In live mode this query would go to a web search API. ` +
          "Treat any conclusion on this topic as unsupported until real sources are gathered.",
        source: DEMO_SOURCE,
      },
    ];
  }
}
