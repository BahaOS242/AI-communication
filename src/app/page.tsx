import Link from "next/link";
import { TaskInput } from "@/components/TaskInput";
import { Badge, Logo, StatusPill } from "@/components/ui";
import { getRepository, runtimeInfo } from "@/lib/orchestration/service";

export const dynamic = "force-dynamic";

async function recentTasks() {
  if (!process.env.DATABASE_URL) return { tasks: [], error: null };
  try {
    return { tasks: await getRepository().listTasks(8), error: null };
  } catch (error) {
    return { tasks: [], error: error instanceof Error ? error.message : "Database unavailable" };
  }
}

const FLOW = [
  { agent: "Manager", text: "plans & delegates", cls: "text-manager" },
  { agent: "Researcher", text: "searches & reports", cls: "text-researcher" },
  { agent: "Critic", text: "challenges & approves", cls: "text-critic" },
  { agent: "Manager", text: "decides what's next", cls: "text-manager" },
];

export default async function Home() {
  const info = runtimeInfo();
  const browserMode = !process.env.DATABASE_URL;
  const { tasks, error } = await recentTasks();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 pb-16">
      <nav className="flex items-center justify-between py-6">
        <Logo />
        <div className="flex flex-wrap items-center justify-end gap-2">
          {info.demoMode && <Badge className="bg-critic/10 text-critic ring-critic/30">Demo mode</Badge>}
          <Badge>model: {info.provider}</Badge>
          <Badge>search: {info.searchTool}{info.searchIsMock ? " (offline)" : ""}</Badge>
        </div>
      </nav>

      <section className="mt-14 mb-8 animate-fade-in">
        <h1 className="text-4xl font-semibold tracking-tight text-ink sm:text-5xl">Give your AI team a task.</h1>
        <p className="mt-3 max-w-xl text-muted">
          A manager, a researcher and a critic collaborate autonomously — planning, gathering evidence, challenging each
          other and iterating until the work holds up.
        </p>
      </section>

      <TaskInput mode={browserMode ? "browser" : "server"} />

      <ol className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-faint">
        {FLOW.map((s, i) => (
          <li key={i} className="flex items-center gap-2">
            <span>
              <span className={s.cls}>{s.agent}</span> {s.text}
            </span>
            {i < FLOW.length - 1 && <span>→</span>}
          </li>
        ))}
        <li>↺ until approved</li>
      </ol>

      {browserMode ? (
        <p className="mt-14 rounded-xl border border-line bg-panel px-4 py-3 text-sm text-muted">
          This hosted demo runs the real orchestration engine in your browser with a scripted model and an offline dataset of
          fictional businesses, so it needs no API keys. To run it with Claude, a live search API and Postgres, see the{" "}
          <a className="text-ink underline underline-offset-2" href="https://github.com/BahaOS242/AI-communication" target="_blank" rel="noreferrer">
            README
          </a>
          .
        </p>
      ) : (
      <section className="mt-14">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Recent tasks</h2>
        {error ? (
          <p className="rounded-lg border border-red-400/20 bg-red-400/5 px-4 py-3 text-sm text-red-300">
            Could not reach the database: {error}. Check DATABASE_URL and run <code className="font-mono">npm run db:deploy</code>.
          </p>
        ) : tasks.length === 0 ? (
          <p className="text-sm text-faint">No tasks yet. Start one above.</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
            {tasks.map((t) => (
              <li key={t.id}>
                <Link href={`/task/${t.id}`} className="flex items-center justify-between gap-4 px-4 py-3 transition hover:bg-panel-2">
                  <span className="truncate text-sm text-ink">{t.objective}</span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="text-xs text-faint">{t.createdAt.toLocaleString()}</span>
                    <StatusPill status={t.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      )}
    </main>
  );
}
