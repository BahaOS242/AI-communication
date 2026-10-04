"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "./ui";

const EXAMPLES = [
  "Research whether a tourist-focused Pilates package would be viable in Nassau.",
  "Determine the best way to reach stopover visitors in Nassau with a boutique fitness offer.",
  "Assess the main risks of launching a wellness retreat business in the Bahamas.",
];

/**
 * `mode="server"` creates a persisted task via the API.
 * `mode="browser"` (no database configured, e.g. the hosted portfolio demo) runs it in-browser.
 */
export function TaskInput({ mode = "server" }: { mode?: "server" | "browser" }) {
  const router = useRouter();
  const [objective, setObjective] = useState(EXAMPLES[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    if (mode === "browser") {
      router.push(`/demo?q=${encodeURIComponent(objective)}`);
      return;
    }
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objective }),
      });
      const body = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !body.id) throw new Error(body.error ?? "Failed to start task");
      router.push(`/task/${body.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start task");
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-panel p-2 shadow-2xl shadow-black/40">
      <textarea
        value={objective}
        onChange={(e) => setObjective(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !submitting) void submit();
        }}
        rows={4}
        placeholder="Describe a complex objective for your AI team…"
        className="w-full resize-none rounded-xl bg-transparent px-4 py-3 text-[17px] leading-relaxed text-ink outline-none placeholder:text-faint"
        aria-label="Objective"
      />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-3 pt-3 pb-1">
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setObjective(ex)}
              className={cn(
                "max-w-[260px] truncate rounded-md border px-2 py-1 text-xs transition",
                objective === ex ? "border-manager/40 bg-manager/10 text-manager" : "border-line text-muted hover:border-faint hover:text-ink",
              )}
              title={ex}
            >
              {ex}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting || objective.trim().length < 10}
          className="inline-flex items-center gap-2 rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold tracking-wide text-canvas transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? (
            <>
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-canvas/30 border-t-canvas" /> STARTING…
            </>
          ) : (
            <>START TASK →</>
          )}
        </button>
      </div>
      {error && <p className="px-4 pb-2 pt-2 text-sm text-red-300">{error}</p>}
    </div>
  );
}
