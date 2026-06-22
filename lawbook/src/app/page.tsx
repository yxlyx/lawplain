import { SearchExplorer } from "@/components/SearchExplorer";
import { type StatsResponse, sgjudge } from "@/lib/sgjudge";

const CORPUS_LABELS: Record<string, string> = {
  judgments: "Judgments",
  statutes: "Statutes",
  statute_sections: "Statute Sections",
  subsidiary_legislation: "Subsidiary Leg.",
  hansard_speeches: "Hansard Speeches",
  bills: "Bills",
  practice_directions: "Practice Directions",
  commentary: "Commentary",
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
  searchParams: Promise<{ tab?: string; q?: string }>;
}) {
  const [{ tab, q }, stats] = await Promise.all([searchParams, getStats()]);

  const courts = (stats?.judgments_by_court ?? [])
    .slice()
    .sort((a, b) => b.n - a.n)
    .map((c) => c.court);

  const counts = stats?.counts ?? {};
  const countEntries = Object.entries(counts).filter(([, n]) => n > 0);
  const hasInitialQuery = (q ?? "").trim().length > 0;

  return (
    <main
      className={`mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-5 sm:px-8 ${
        hasInitialQuery ? "justify-start" : "justify-center"
      }`}
    >
      {/* Brand — Google-style minimal landing */}
      <section className={hasInitialQuery ? "pt-10 pb-5" : "pb-5"}>
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="font-serif text-5xl font-medium tracking-tight text-foreground sm:text-7xl">
            Lawplain<span className="text-accent">.</span>
          </h1>
          <p className="mt-3 text-sm font-semibold tracking-tight text-muted sm:text-base">
            Search Singapore judgments, statutes, Hansard &amp; more
          </p>
        </div>
      </section>

      {/* Search */}
      <section className="mx-auto max-w-2xl pb-3">
        <SearchExplorer
          courts={courts}
          initialTab={tab ?? "judgments"}
          initialQuery={q ?? ""}
        />
      </section>

      {/* One quiet stats line, Google-footer style */}
      {countEntries.length > 0 && (
        <p className="mx-auto max-w-3xl pb-4 pt-4 text-center text-xs leading-relaxed text-muted-2">
          {countEntries.map(([key, n], i) => (
            <span key={key}>
              {i > 0 && <span className="mx-1.5 text-border-strong">·</span>}
              <span className="font-medium tabular-nums text-muted">
                {n.toLocaleString()}
              </span>{" "}
              {CORPUS_LABELS[key] ?? key}
            </span>
          ))}
        </p>
      )}
    </main>
  );
}
