import { SearchExplorer } from "@/components/SearchExplorer";
import { type StatsResponse, sgjudge } from "@/lib/sgjudge";

const CORPUS_LABELS: Record<string, string> = {
  judgments: "Judgments",
  statutes: "Statutes",
  subsidiary_legislation: "Subsidiary",
  hansard: "Hansard",
  bills: "Bills",
  practice_directions: "Practice Dir.",
};

async function getStats(): Promise<StatsResponse | null> {
  try {
    // Fresh each request; the corpus is small and updated out-of-band.
    return await sgjudge.stats({ cache: "no-store" });
  } catch {
    return null;
  }
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ tab }, stats] = await Promise.all([searchParams, getStats()]);

  const courts = (stats?.judgments_by_court ?? [])
    .slice()
    .sort((a, b) => b.n - a.n)
    .map((c) => c.court);

  const counts = stats?.counts ?? {};
  const countEntries = Object.entries(counts).filter(([, n]) => n > 0);

  return (
    <main className="mx-auto w-full max-w-6xl px-5 sm:px-8">
      {/* Hero */}
      <section className="pt-16 pb-10 sm:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            Public · read-only · Singapore legal corpus
          </span>
          <h1 className="text-balance text-4xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-6xl">
            Research Singapore law,{" "}
            <span className="text-accent">in one search.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-pretty text-base leading-relaxed text-muted sm:text-lg">
            Full-text search across judgments, statutes, subsidiary legislation,
            parliamentary Hansard, bills and practice directions.
          </p>
        </div>
      </section>

      {/* Search */}
      <section className="mx-auto max-w-3xl pb-6">
        <SearchExplorer courts={courts} initialTab={tab ?? "judgments"} />
      </section>

      {/* Stats */}
      {countEntries.length > 0 && (
        <section className="border-t border-border py-12">
          <h2 className="mb-6 text-center text-xs font-semibold uppercase tracking-[0.18em] text-muted-2">
            Corpus at a glance
          </h2>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {countEntries.map(([key, n]) => (
              <div
                key={key}
                className="rounded-xl border border-border bg-surface px-4 py-5 text-center transition-colors hover:border-border-strong"
              >
                <dd className="text-2xl font-semibold tabular-nums text-foreground">
                  {n.toLocaleString()}
                </dd>
                <dt className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-2">
                  {CORPUS_LABELS[key] ?? key}
                </dt>
              </div>
            ))}
          </dl>

          {courts.length > 0 && (
            <div className="mt-8">
              <h3 className="mb-3 text-center text-xs font-semibold uppercase tracking-[0.18em] text-muted-2">
                Judgments by court
              </h3>
              <CourtBars data={stats?.judgments_by_court ?? []} />
            </div>
          )}
        </section>
      )}
    </main>
  );
}

function CourtBars({ data }: { data: { court: string; n: number }[] }) {
  const sorted = data
    .slice()
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);
  const max = Math.max(...sorted.map((d) => d.n), 1);
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-2">
      {sorted.map((d) => (
        <div key={d.court} className="flex items-center gap-3">
          <span className="w-16 shrink-0 text-right font-mono text-xs text-muted">
            {d.court}
          </span>
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.max(4, (d.n / max) * 100)}%` }}
            />
          </div>
          <span className="w-12 shrink-0 text-xs tabular-nums text-muted-2">
            {d.n.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}
