import type { FinalResult as FinalResultData } from "@/lib/domain";
import { Badge, Card, cn } from "./ui";

const CONFIDENCE: Record<string, string> = {
  high: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/30",
  medium: "bg-critic/10 text-critic ring-critic/30",
  low: "bg-red-400/10 text-red-300 ring-red-400/30",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{title}</h3>
      {children}
    </div>
  );
}

export function FinalResult({ result }: { result: FinalResultData }) {
  const partial = result.kind === "partial";
  const usesDemo = result.evidence.some((e) => e.isMock);
  return (
    <Card
      className={cn("animate-fade-in", partial ? "border-red-400/30" : "border-emerald-400/25")}
      title={partial ? "Partial result — requires review" : "Final result"}
      action={<Badge className={CONFIDENCE[result.confidence]}>confidence: {result.confidence}</Badge>}
    >
      <div className="space-y-6 p-5">
        {partial && (
          <p className="rounded-lg border border-red-400/20 bg-red-400/5 px-3 py-2 text-sm text-red-200">
            The team did not finish. This is the work completed so far and it has not been fully validated.
          </p>
        )}
        {usesDemo && (
          <p className="rounded-lg border border-critic/20 bg-critic/5 px-3 py-2 text-xs text-critic">
            Demo mode: evidence comes from an offline, illustrative dataset with fictional businesses — not the live web.
          </p>
        )}

        <Section title="Summary">
          <p className="text-[15px] leading-relaxed text-ink">{result.summary}</p>
        </Section>

        <Section title="Key findings">
          <ul className="space-y-2">
            {result.keyFindings.map((f, i) => (
              <li key={i} className="rounded-lg border border-line bg-canvas/40 px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-ink">{f.title}</p>
                  <span className="flex shrink-0 gap-1">
                    {f.sourceIds.map((s) => (
                      <a key={s} href={`#source-${s}`}>
                        <Badge className="bg-researcher/5 font-mono text-researcher ring-researcher/20">{s}</Badge>
                      </a>
                    ))}
                  </span>
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">{f.detail}</p>
              </li>
            ))}
          </ul>
        </Section>

        <div className="grid gap-6 md:grid-cols-2">
          <Section title="Uncertainties">
            <ul className="space-y-1.5">
              {result.uncertainties.map((u, i) => (
                <li key={i} className="flex gap-2 text-[13px] text-ink/85">
                  <span className="text-orange-300">?</span>
                  {u}
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Recommendations">
            <ul className="space-y-1.5">
              {result.recommendations.map((r, i) => (
                <li key={i} className="flex gap-2 text-[13px] text-ink/85">
                  <span className="text-emerald-300">→</span>
                  {r}
                </li>
              ))}
            </ul>
          </Section>
        </div>

        <Section title="Conclusion">
          <p className="rounded-lg border border-line bg-panel-2 px-4 py-3 text-[15px] font-medium text-ink">{result.conclusion}</p>
        </Section>

        <Section title={`Evidence (${result.evidence.length})`}>
          <ul className="space-y-1.5">
            {result.evidence.map((e) => (
              <li key={e.sourceId} id={`source-${e.sourceId}`} className="flex gap-3 text-[13px]">
                <span className="w-9 shrink-0 font-mono text-xs text-researcher">{e.sourceId}</span>
                <div className="min-w-0">
                  {e.url ? (
                    <a href={e.url} target="_blank" rel="noreferrer" className="text-ink underline decoration-line underline-offset-2 hover:decoration-ink">
                      {e.title}
                    </a>
                  ) : (
                    <span className="text-ink">{e.title}</span>
                  )}
                  <p className="line-clamp-2 text-xs text-muted">{e.snippet}</p>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </Card>
  );
}
