import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import { HomeShell } from "@/components/HomeShell";
import { buildMetadata, DEFAULT_DESCRIPTION, DEFAULT_TITLE } from "@/lib/seo";
import { type StatsResponse, sgjudge } from "@/lib/sgjudge";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string }>;
}): Promise<Metadata> {
  const { tab, q } = await searchParams;
  const hasQueryVariant = Boolean(tab || q?.trim());

  return buildMetadata({
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    path: "/",
    absoluteTitle: true,
    noIndex: hasQueryVariant,
    noIndexFollow: hasQueryVariant,
  });
}

const CORPUS_LABELS: Record<string, string> = {
  judgments: "Judgments",
  statutes: "Statutes",
  statute_sections: "Statute Sections",
  subsidiary_legislation: "Subsidiary Leg.",
  hansard_speeches: "Hansard Speeches",
  bills: "Bills",
  practice_directions: "Practice Directions",
  agency_guidance: "Agency Guidance",
  commentary: "Commentary",
};

const STATS_KEY = "stats:v1";
const STATS_TTL_MS = 5 * 60 * 1000;

interface CachedStats {
  data: StatsResponse;
  at: number;
}

async function fetchAndStore(
  kv: KVNamespace | undefined,
): Promise<StatsResponse | null> {
  try {
    const data = await sgjudge.stats({ cache: "no-store" });
    if (data && kv) {
      await kv
        .put(STATS_KEY, JSON.stringify({ data, at: Date.now() } as CachedStats))
        .catch(() => {});
    }
    return data;
  } catch {
    return null;
  }
}

async function getStats(): Promise<StatsResponse | null> {
  const { env, ctx } = await getCloudflareContext({ async: true });
  const kv = (env as { STATS_KV?: KVNamespace }).STATS_KV;

  // 1. KV first — edge-fast, no backend round-trip on a hit.
  let cached: CachedStats | null = null;
  if (kv) {
    try {
      const raw = await kv.get(STATS_KEY);
      if (raw) cached = JSON.parse(raw) as CachedStats;
    } catch {
      // ignore malformed / unavailable cache
    }
  }
  if (cached && Date.now() - cached.at < STATS_TTL_MS) {
    return cached.data; // fresh hit
  }

  // 2. Miss or stale — refresh in the background (fills KV) so we never block.
  const refresh = fetchAndStore(kv);
  ctx?.waitUntil(refresh.catch(() => {}));

  // Serve stale instantly; on a cold cache wait briefly, else render w/o stats.
  if (cached) return cached.data;
  return Promise.race([
    refresh,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
  ]);
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

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col px-5 sm:px-8">
      <HomeShell
        courts={courts}
        initialTab={tab ?? "judgments"}
        initialQuery={q ?? ""}
        stats={
          countEntries.length > 0 ? (
            <p className="mx-auto max-w-3xl pb-4 text-center text-xs leading-relaxed text-muted-2">
              {countEntries.map(([key, n], i) => (
                <span key={key}>
                  {i > 0 && (
                    <span className="mx-1.5 text-border-strong">·</span>
                  )}
                  <span className="font-medium tabular-nums text-muted">
                    {n.toLocaleString()}
                  </span>{" "}
                  {CORPUS_LABELS[key] ?? key}
                </span>
              ))}
            </p>
          ) : null
        }
      />
    </main>
  );
}
