"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { SearchIcon, XIcon } from "@/components/icons";
import { ScoreBar } from "@/components/ScoreBar";
import { Snippet } from "@/components/Snippet";
import { authClient } from "@/lib/auth-client";
import {
  canonicalFilterFields,
  canonicalSearchParams,
  canonicalSearchSignature,
  canonicalSearchState,
} from "@/lib/search-state";
import {
  ApiError,
  guidanceLegalStatusLabel,
  type SearchHit,
  type SearchResponse,
  sgjudge,
} from "@/lib/sgjudge";

type TabId =
  | "judgments"
  | "statutes"
  | "hansard"
  | "bills"
  | "subsidiary"
  | "practice"
  | "guidance";

const TABS: { id: TabId; label: string }[] = [
  { id: "judgments", label: "Judgments" },
  { id: "statutes", label: "Statutes" },
  { id: "hansard", label: "Hansard" },
  { id: "bills", label: "Bills" },
  { id: "subsidiary", label: "Subsidiary Leg." },
  { id: "practice", label: "Practice Dir." },
  { id: "guidance", label: "Guidance" },
];

const PLACEHOLDERS: Record<TabId, string> = {
  judgments: "e.g. negligence duty of care",
  statutes: "e.g. unlawful assembly",
  hansard: "e.g. housing affordability",
  bills: "e.g. data protection",
  subsidiary: "e.g. traffic regulations",
  practice: "e.g. electronic filing",
  guidance: "e.g. workplace fairness or consent",
};

interface Filters {
  court?: string;
  year_range?: string;
  judge?: string;
  kind?: string;
  speaker?: string;
  since?: string;
  agency?: string;
  document_kind?: string;
}

interface ResultSnapshotItem {
  id: string;
  rank: number;
  title: string;
  path: string;
  citation?: string;
  reference?: string;
  score?: number;
}

interface SearchHistoryEntry {
  id: string;
  tab: TabId;
  query: string;
  filters: Filters;
  resultCount: number;
  topResults: ResultSnapshotItem[];
  createdAt: number;
}

const DEBOUNCE_MS = 250;
const MIN_CHARS = 3; // 1-2 char FTS prefixes (e.g. "sa") scan the whole corpus
function filtersFromSearchParams(params: URLSearchParams): Filters {
  return canonicalSearchState(params).filters as Filters;
}

export function searchStateFromParams(params: URLSearchParams): {
  tab: TabId;
  query: string;
  filters: Filters;
} {
  return canonicalSearchState(params) as {
    tab: TabId;
    query: string;
    filters: Filters;
  };
}

function buildSearchParams(
  tab: TabId,
  query: string,
  filters: Filters,
): URLSearchParams {
  return canonicalSearchParams(tab, query, filters);
}

function runSearch(
  tab: TabId,
  q: string,
  f: Filters,
  signal: AbortSignal,
): Promise<SearchResponse> {
  const init = { signal };
  switch (tab) {
    case "judgments":
      return sgjudge.searchJudgments(
        q,
        { court: f.court, year_range: f.year_range, judge: f.judge, limit: 20 },
        init,
      );
    case "statutes":
      return sgjudge.searchStatutes(q, { kind: f.kind, limit: 20 }, init);
    case "hansard":
      return sgjudge.searchHansard(
        q,
        { speaker: f.speaker, since: f.since, limit: 20 },
        init,
      );
    case "bills":
      // The corpus currently exposes a single bill status ('introduced') and no
      // sessions, so those filters are omitted until the dataset offers variety.
      return sgjudge.searchBills(q, { limit: 20 }, init);
    case "subsidiary":
      return sgjudge.searchSubsidiary(q, { limit: 20 }, init);
    case "practice":
      return sgjudge.searchPracticeDirections(
        q,
        { court: f.court, limit: 20 },
        init,
      );
    case "guidance":
      return sgjudge.searchAgencyGuidance(
        q,
        { agency: f.agency, document_kind: f.document_kind, limit: 20 },
        init,
      );
  }
}

export function SearchExplorer({
  courts = [],
  initialTab = "judgments",
  initialQuery = "",
  onActiveChange,
}: {
  courts?: string[];
  initialTab?: string;
  initialQuery?: string;
  /** Notifies the parent when a query becomes (non-)empty, for the
   *  Google-style hero collapse on the home page. */
  onActiveChange?: (active: boolean) => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const startTab = TABS.some((t) => t.id === initialTab)
    ? (initialTab as TabId)
    : "judgments";
  const [tab, setTab] = useState<TabId>(startTab);
  const [q, setQ] = useState(initialQuery);
  const [filters, setFilters] = useState<Filters>(() =>
    filtersFromSearchParams(searchParams),
  );
  const [showFilters, setShowFilters] = useState(() =>
    Object.values(filtersFromSearchParams(searchParams)).some(Boolean),
  );
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentSearches, setRecentSearches] = useState<SearchHistoryEntry[]>(
    [],
  );
  const [composing, setComposing] = useState(false);
  const seq = useRef(0);
  const applyingUrlState = useRef("");
  const focusedUrl = useRef("");
  const searchInput = useRef<HTMLInputElement>(null);
  const lastRecorded = useRef("");
  const { data: session } = authClient.useSession();
  const isSignedIn = Boolean(session?.user);

  useEffect(() => {
    onActiveChange?.(q.trim().length > 0);
  }, [q, onActiveChange]);
  function selectTab(next: TabId) {
    if (next === tab) return;
    setTab(next);
    setFilters({});
    setData(null);
    setError(null);
  }

  const urlKey = searchParams.toString();
  const localSearchSignature = canonicalSearchSignature(tab, q, filters);
  const localSearchSignatureRef = useRef(localSearchSignature);
  localSearchSignatureRef.current = localSearchSignature;
  useEffect(() => {
    const params = new URLSearchParams(urlKey);
    const inbound = searchStateFromParams(params);
    const signature = canonicalSearchSignature(
      inbound.tab,
      inbound.query,
      inbound.filters,
    );
    if (signature !== localSearchSignatureRef.current) {
      applyingUrlState.current = signature;
      setTab(inbound.tab);
      setQ(inbound.query);
      setFilters(inbound.filters);
      setShowFilters(Object.values(inbound.filters).some(Boolean));
    }

    if (params.get("focus") !== "search") {
      focusedUrl.current = "";
    } else if (focusedUrl.current !== urlKey) {
      focusedUrl.current = urlKey;
      searchInput.current?.focus();
    }
  }, [urlKey]);

  useEffect(() => {
    if (composing) return;
    const signature = buildSearchParams(tab, q, filters).toString();
    if (signature === applyingUrlState.current) {
      applyingUrlState.current = "";
      return;
    }
    const timer = setTimeout(() => {
      const current = new URLSearchParams(window.location.search);
      if (current.toString() !== urlKey) return;
      const canonicalCurrent = buildSearchParams(
        searchStateFromParams(current).tab,
        searchStateFromParams(current).query,
        searchStateFromParams(current).filters,
      ).toString();
      if (window.location.pathname === "/" && canonicalCurrent !== signature) {
        router.replace(`/?${signature}`, { scroll: false });
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [tab, q, filters, router, urlKey, composing]);

  const searchSignature = localSearchSignature;
  useEffect(() => {
    const id = ++seq.current;
    const controller = new AbortController();
    setData(null);
    setError(null);
    setLoading(false);
    if (composing) return () => controller.abort();

    const current = searchStateFromParams(new URLSearchParams(searchSignature));
    const snapshot = {
      tab: current.tab,
      query: current.query,
      filters: Object.freeze({ ...current.filters }),
    };
    if (snapshot.query.length < MIN_CHARS) return () => controller.abort();

    const timer = setTimeout(async () => {
      if (id !== seq.current) return;
      setLoading(true);
      try {
        const res = await runSearch(
          snapshot.tab,
          snapshot.query,
          snapshot.filters,
          controller.signal,
        );
        if (id === seq.current && !controller.signal.aborted) setData(res);
      } catch (err) {
        if (controller.signal.aborted) return;
        if (id === seq.current) {
          setError(
            err instanceof ApiError
              ? `${err.status} — ${err.message}`
              : "Something went wrong. Please try again.",
          );
        }
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchSignature, composing]);

  const loadRecentSearches = useCallback(
    async ({ clearOnError = true }: { clearOnError?: boolean } = {}) => {
      const res = await fetch("/api/search-history?limit=5").catch(() => null);
      if (!res?.ok) {
        if (clearOnError) setRecentSearches([]);
        return;
      }
      const payload = (await res.json().catch(() => null)) as {
        searches?: SearchHistoryEntry[];
      } | null;
      setRecentSearches(payload?.searches ?? []);
    },
    [],
  );

  useEffect(() => {
    if (!isSignedIn) {
      setRecentSearches([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/search-history?limit=5").catch(() => null);
      if (cancelled) return;
      if (!res?.ok) {
        setRecentSearches([]);
        return;
      }
      const payload = (await res.json().catch(() => null)) as {
        searches?: SearchHistoryEntry[];
      } | null;
      if (!cancelled) setRecentSearches(payload?.searches ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [isSignedIn]);

  const ranked = useMemo(
    () => rerankResults(tab, data?.results ?? [], data?.query ?? ""),
    [tab, data],
  );
  const currentSnapshot = useMemo(
    () => buildSnapshot(tab, ranked, data?.query ?? q.trim(), filters),
    [tab, ranked, data?.query, q, filters],
  );
  const hasQuery = q.trim().length >= MIN_CHARS;

  const recordCurrentSearch = useCallback(async () => {
    if (!isSignedIn || !data || error || data.query.trim().length < MIN_CHARS) {
      return;
    }
    const signature = JSON.stringify({
      tab,
      query: data.query,
      filters,
      count: data.count,
    });
    if (signature === lastRecorded.current) return;
    lastRecorded.current = signature;
    const res = await fetch("/api/search-history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tab,
        query: data.query,
        filters,
        resultCount: data.count,
        topResults: currentSnapshot.slice(0, 10),
      }),
    }).catch(() => null);
    if (!res?.ok) {
      lastRecorded.current = "";
      return;
    }

    await loadRecentSearches({ clearOnError: false });
  }, [
    isSignedIn,
    data,
    error,
    tab,
    filters,
    currentSnapshot,
    loadRecentSearches,
  ]);

  const visibleFilterNames = showFilters
    ? tab === "judgments"
      ? ["court", "judge"]
      : tab === "practice"
        ? ["court"]
        : tab === "statutes"
          ? ["kind"]
          : tab === "hansard"
            ? ["speaker", "since"]
            : tab === "guidance"
              ? ["agency", "document_kind"]
              : []
    : [];
  const hiddenFilterFields = canonicalFilterFields(
    filters,
    visibleFilterNames,
  ) as { name: keyof Filters; value: string }[];

  return (
    <form action="/" method="get" className="w-full" aria-busy={loading}>
      {hiddenFilterFields.map(({ name, value }) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-2" />
        <input
          ref={searchInput}
          name="q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={(e) => {
            setQ(e.currentTarget.value);
            setComposing(false);
          }}
          placeholder={PLACEHOLDERS[tab]}
          aria-label={`Search ${TABS.find((t) => t.id === tab)?.label ?? "corpus"}`}
          autoComplete="off"
          spellCheck={false}
          className="h-14 w-full rounded-full border border-border bg-surface pl-13 pr-13 text-base text-foreground shadow-[0_1px_6px_rgba(32,33,36,0.12)] outline-none transition-shadow placeholder:text-muted-2 hover:shadow-[0_2px_10px_rgba(22,26,38,0.14)] focus:border-ring/40 focus:shadow-[0_2px_12px_rgba(41,98,255,0.22)]"
        />
        {loading && (
          <Spinner className="absolute right-11 top-1/2 h-5 w-5 -translate-y-1/2 text-accent" />
        )}
        {q && (
          <button
            type="button"
            onClick={() => setQ("")}
            aria-label="Clear search"
            className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-muted-2 transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <XIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      {isSignedIn && recentSearches.length > 0 && (
        <section className="mt-4 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
          <div className="flex items-center justify-between border-border border-b px-4 py-2">
            <span className="text-xs font-medium text-muted-2">
              Recent searches
            </span>
            <button
              type="button"
              onClick={() => {
                fetch("/api/search-history", { method: "DELETE" }).catch(
                  () => undefined,
                );
                setRecentSearches([]);
              }}
              className="text-xs font-medium text-muted-2 transition-colors hover:text-accent"
            >
              Clear
            </button>
          </div>
          <ul className="divide-y divide-border">
            {recentSearches.slice(0, 5).map((entry) => {
              const tabLabel =
                TABS.find((t) => t.id === entry.tab)?.label ?? entry.tab;
              const resultLabel = `${entry.resultCount} result${
                entry.resultCount === 1 ? "" : "s"
              }`;

              return (
                <li key={entry.id} className="group flex items-center">
                  <button
                    type="button"
                    title={`${tabLabel}: ${entry.query} · ${resultLabel}`}
                    onClick={() => {
                      setTab(entry.tab);
                      setQ(entry.query);
                      setFilters(entry.filters);
                      setData(null);
                      setError(null);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2"
                  >
                    <SearchIcon className="h-4 w-4 shrink-0 text-muted-2" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-foreground">
                        {entry.query}
                      </span>
                      <span className="block truncate text-xs text-muted-2">
                        {tabLabel} · {resultLabel}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove recent search: ${entry.query}`}
                    onClick={async () => {
                      const previousSearches = recentSearches;
                      setRecentSearches((searches) =>
                        searches.filter((search) => search.id !== entry.id),
                      );
                      const res = await fetch(
                        `/api/search-history/${encodeURIComponent(entry.id)}`,
                        { method: "DELETE" },
                      ).catch(() => null);
                      if (!res?.ok) {
                        setRecentSearches(previousSearches);
                        return;
                      }
                      await loadRecentSearches({ clearOnError: false });
                    }}
                    className="mr-2 rounded-full p-1.5 text-muted-2 opacity-70 transition-colors hover:bg-surface-2 hover:text-foreground group-hover:opacity-100"
                  >
                    <XIcon className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="mt-4 flex flex-wrap justify-center gap-1.5">
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <Link
              key={t.id}
              href={`/?${buildSearchParams(t.id, q, filters).toString()}`}
              onClick={(event) => {
                if (
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return;
                event.preventDefault();
                selectTab(t.id);
              }}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm transition-colors ${
                active
                  ? "bg-accent-soft font-medium text-accent"
                  : "text-muted hover:bg-surface-2 hover:text-foreground"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
        <input type="hidden" name="tab" value={tab} />
      </div>

      {(() => {
        const activeCount = Object.values(filters).filter((v) =>
          Boolean(v?.trim()),
        ).length;
        return (
          <div className="mt-3 flex justify-center">
            <button
              type="button"
              onClick={() => setShowFilters((s) => !s)}
              aria-expanded={showFilters}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                showFilters || activeCount > 0
                  ? "border-accent/40 bg-accent-soft text-accent"
                  : "border-border text-muted-2 hover:bg-surface-2 hover:text-foreground"
              }`}
            >
              <svg
                viewBox="0 0 16 16"
                aria-hidden="true"
                className="h-3.5 w-3.5"
                fill="currentColor"
              >
                <path d="M2 4h12l-4.5 5v3.5l-3 1.5V9z" />
              </svg>
              Filters
              {activeCount > 0 && (
                <span className="tabular-nums">· {activeCount}</span>
              )}
              <svg
                viewBox="0 0 16 16"
                aria-hidden="true"
                className={`h-3 w-3 transition-transform ${showFilters ? "rotate-180" : ""}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m4 6 4 4 4-4" />
              </svg>
            </button>
          </div>
        );
      })()}

      {showFilters && (
        <FilterRow
          tab={tab}
          courts={courts}
          filters={filters}
          onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
          onClear={() => setFilters({})}
        />
      )}

      {tab === "guidance" && (
        <aside className="mt-4 rounded-xl border border-border bg-surface-2/50 px-4 py-3 text-xs leading-relaxed text-muted">
          <span className="font-semibold text-foreground">
            Official agency guidance — not legislation.
          </span>{" "}
          Search source material from agencies such as TAFEP and PDPC, then
          verify the current document on the linked official website.
        </aside>
      )}

      <div className="mt-5" aria-live="polite" aria-atomic="false">
        <output className="sr-only">
          {loading
            ? "Searching"
            : data
              ? `${data.count} search result${data.count === 1 ? "" : "s"}`
              : (error ?? "")}
        </output>
        {hasQuery && error && (
          <div className="rounded-lg border border-border bg-surface p-5 text-sm text-muted">
            {error}
          </div>
        )}
        {hasQuery && !error && data && (
          <>
            <div className="mb-3 flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-2">
                  {data.count >= 20
                    ? "Top 20 results"
                    : `${data.count} result${data.count === 1 ? "" : "s"}`}{" "}
                  for{" "}
                  <span className="font-semibold text-muted">
                    &ldquo;{data.query}&rdquo;
                  </span>
                </p>
                {isSignedIn && (
                  <span className="text-xs text-muted-2">
                    Searches are saved to your recent history.
                  </span>
                )}
              </div>
            </div>
            {data.results.length === 0 ? (
              <EmptyState
                title={`No matches for “${data.query}”`}
                hint="Try broader or different keywords, switch corpus tabs, or clear a filter."
              />
            ) : (
              <ul className="flex flex-col gap-3">
                {ranked.map(({ hit, relevance }, i) => (
                  <li
                    key={
                      (hit.citation as string) ??
                      (hit.act_id as string) ??
                      (hit.guidance_id as string) ??
                      i
                    }
                    className="motion-fade-up"
                    style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}
                  >
                    <ResultCard
                      tab={tab}
                      hit={hit}
                      query={data.query}
                      filters={filters}
                      fraction={relevance}
                      onBeforeNavigate={
                        isSignedIn ? recordCurrentSearch : undefined
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {hasQuery && !error && !data && loading && <SkeletonList />}
      </div>
    </form>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-1 ${className ?? ""}`}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">
        {label}
      </span>
      {children}
    </div>
  );
}

function splitYear(range?: string): [string, string] {
  if (!range) return ["", ""];
  const [from, to] = range.split("-");
  return [from?.trim() ?? "", to?.trim() ?? ""];
}

function composeYear(from: string, to: string): string | undefined {
  const f = from.replace(/\D/g, "").slice(0, 4);
  const t = to.replace(/\D/g, "").slice(0, 4);
  if (f && t) return `${f}-${t}`;
  return f || t || undefined;
}

function FilterRow({
  tab,
  courts,
  filters,
  onChange,
  onClear,
}: {
  tab: TabId;
  courts: string[];
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
  onClear: () => void;
}) {
  const inputCls =
    "h-9 rounded-lg border border-border bg-surface px-3 text-sm text-foreground outline-none placeholder:text-muted-2 focus:border-ring focus:ring-2 focus:ring-ring/15";
  const fields: React.ReactNode[] = [];

  if (tab === "judgments" || tab === "practice") {
    fields.push(
      <Field key="court" label="Court">
        <select
          name="court"
          value={filters.court ?? ""}
          onChange={(e) => onChange({ court: e.target.value || undefined })}
          className={inputCls}
        >
          <option value="">All courts</option>
          {courts.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>,
    );
  }
  const [yearFrom, yearTo] = splitYear(filters.year_range);
  if (tab === "judgments") {
    fields.push(
      <Field key="year" label="Year">
        <div className="flex items-center gap-1.5">
          <input
            inputMode="numeric"
            maxLength={4}
            value={yearFrom}
            onChange={(e) =>
              onChange({ year_range: composeYear(e.target.value, yearTo) })
            }
            placeholder="From"
            className={`${inputCls} w-20`}
          />
          <span className="text-muted-2">&ndash;</span>
          <input
            inputMode="numeric"
            maxLength={4}
            value={yearTo}
            onChange={(e) =>
              onChange({ year_range: composeYear(yearFrom, e.target.value) })
            }
            placeholder="To"
            className={`${inputCls} w-20`}
          />
        </div>
      </Field>,
      <Field key="judge" label="Coram" className="w-44">
        <input
          name="judge"
          value={filters.judge ?? ""}
          onChange={(e) => onChange({ judge: e.target.value || undefined })}
          placeholder="Judge name"
          className={inputCls}
        />
      </Field>,
    );
  }
  if (tab === "statutes") {
    fields.push(
      <Field key="kind" label="Status">
        <select
          name="kind"
          value={filters.kind ?? ""}
          onChange={(e) => onChange({ kind: e.target.value || undefined })}
          className={inputCls}
        >
          <option value="">All kinds</option>
          <option value="act_current">Act (current)</option>
          <option value="act_repealed">Act (repealed)</option>
        </select>
      </Field>,
    );
  }
  if (tab === "hansard") {
    fields.push(
      <Field key="speaker" label="Speaker" className="w-44">
        <input
          name="speaker"
          value={filters.speaker ?? ""}
          onChange={(e) => onChange({ speaker: e.target.value || undefined })}
          placeholder="Speaker name"
          className={inputCls}
        />
      </Field>,
      <Field key="since" label="On or after">
        <input
          type="date"
          name="since"
          value={filters.since ?? ""}
          onChange={(e) => onChange({ since: e.target.value || undefined })}
          className={inputCls}
        />
      </Field>,
    );
  }
  if (tab === "guidance") {
    fields.push(
      <Field key="agency" label="Agency">
        <select
          name="agency"
          value={filters.agency ?? ""}
          onChange={(e) => onChange({ agency: e.target.value || undefined })}
          className={inputCls}
        >
          <option value="">All agencies</option>
          <option value="TAFEP">TAFEP</option>
          <option value="PDPC">PDPC</option>
        </select>
      </Field>,
      <Field key="document-kind" label="Document type">
        <select
          name="document_kind"
          value={filters.document_kind ?? ""}
          onChange={(e) =>
            onChange({ document_kind: e.target.value || undefined })
          }
          className={inputCls}
        >
          <option value="">All types</option>
          <option value="guideline">Guideline</option>
          <option value="advisory_guideline">Advisory guideline</option>
          <option value="framework">Framework</option>
          <option value="guide">Guide</option>
        </select>
      </Field>,
    );
  }

  if (fields.length === 0) return null;

  const activeCount = Object.values(filters).filter(Boolean).length;

  return (
    <div className="mt-4 rounded-2xl border border-border bg-surface-2/40 px-4 py-3">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">
          Filters
        </span>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs font-medium text-accent transition-colors hover:text-foreground"
          >
            Clear {activeCount} filter{activeCount === 1 ? "" : "s"}
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-3">{fields}</div>
    </div>
  );
}

function ResultCard({
  tab,
  hit,
  query,
  filters,
  fraction,
  onBeforeNavigate,
}: {
  tab: TabId;
  hit: SearchHit;
  query: string;
  filters: Filters;
  fraction: number;
  onBeforeNavigate?: () => Promise<void>;
}) {
  const router = useRouter();
  const href = detailHref(tab, hit, query, filters);
  const title = cardTitle(tab, hit);
  const meta = cardMeta(tab, hit);

  const inner = (
    <article className="group rounded-2xl border border-border bg-surface p-5 transition-all hover:border-border-strong hover:shadow-md">
      <div className="mb-1.5 flex items-start justify-between gap-4">
        <h3
          className={`font-serif text-lg font-medium leading-snug tracking-tight text-foreground ${
            href ? "transition-colors group-hover:text-accent" : ""
          }`}
        >
          {title}
        </h3>
        <div className="shrink-0 pt-1">
          <ScoreBar fraction={fraction} />
        </div>
      </div>
      {meta.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-2">
          {meta.map((m, i) => (
            <span key={m.key} className="flex items-center gap-2">
              {i > 0 && <span className="text-border-strong">·</span>}
              {m.node}
            </span>
          ))}
        </div>
      )}
      <Snippet html={hit.snippet} />
    </article>
  );

  if (!href) return inner;

  if (isExternalHref(href)) {
    return (
      <a
        href={href}
        aria-label={title}
        className="block"
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => {
          if (onBeforeNavigate) void onBeforeNavigate();
        }}
      >
        {inner}
      </a>
    );
  }

  return (
    <Link
      href={href}
      aria-label={title}
      className="block"
      onClick={async (event) => {
        if (event.defaultPrevented || !onBeforeNavigate) return;
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          void onBeforeNavigate();
          return;
        }
        event.preventDefault();
        try {
          await onBeforeNavigate();
        } finally {
          router.push(href);
        }
      }}
      onAuxClick={(event) => {
        if (event.defaultPrevented || event.button !== 1 || !onBeforeNavigate) {
          return;
        }
        void onBeforeNavigate();
      }}
    >
      {inner}
    </Link>
  );
}

function detailHref(
  tab: TabId,
  hit: SearchHit,
  query: string,
  filters: Filters,
): string | null {
  const returnTo = `/?${buildSearchParams(tab, query, filters).toString()}`;
  const qs = new URLSearchParams();
  if (query) qs.set("q", query);
  qs.set("returnTo", returnTo);
  const suffix = `?${qs.toString()}`;
  if (tab === "judgments" && typeof hit.citation === "string") {
    return `/judgment/${encodeURIComponent(hit.citation)}${suffix}`;
  }
  if (tab === "statutes" && typeof hit.act_id === "string") {
    return `/statute/${encodeURIComponent(hit.act_id)}${suffix}`;
  }

  const id = resultDetailId(tab, hit);
  if (!id) return null;

  qs.set("title", cardTitle(tab, hit));
  if (hit.snippet) qs.set("snippet", String(hit.snippet));
  if (tab === "guidance" && typeof hit.source_url === "string") {
    qs.set("source", hit.source_url);
  }
  const meta = detailMeta(tab, hit);
  if (meta.length > 0) qs.set("meta", JSON.stringify(meta));
  return `/document/${encodeURIComponent(tab)}/${encodeURIComponent(id)}?${qs.toString()}`;
}

function resultDetailId(tab: TabId, hit: SearchHit): string | null {
  const key =
    tab === "hansard"
      ? hit.speech_id
      : tab === "bills"
        ? hit.bill_id
        : tab === "subsidiary"
          ? hit.sl_id
          : tab === "practice"
            ? hit.pd_id
            : tab === "guidance"
              ? hit.guidance_id
              : null;
  return typeof key === "string" && key ? key : null;
}

function detailMeta(tab: TabId, hit: SearchHit): [string, string][] {
  const out: [string, string][] = [];
  const add = (label: string, value: unknown) => {
    if (value !== undefined && value !== null && value !== "") {
      out.push([label, String(value)]);
    }
  };

  if (tab === "hansard") {
    add("Speaker", hit.speaker);
    add("Party", hit.party);
    add("Constituency", hit.constituency);
    add("Date", hit.date);
  } else if (tab === "bills") {
    add("Bill number", hit.bill_number);
    add("Year", hit.year);
    add("Status", hit.status);
    add("Introduced", hit.introduced_date);
  } else if (tab === "subsidiary") {
    add("Parent Act", hit.parent_act_id);
    add("Number", hit.sl_number);
    add("Date", hit.doc_date);
  } else if (tab === "practice") {
    add("Court", hit.court);
    add("Number", hit.pd_number);
    add("Effective", hit.effective_date);
  } else if (tab === "guidance") {
    add("Agency", hit.agency);
    add("Document type", humanizeGuidanceKind(hit.document_kind));
    add("Legal status", guidanceLegalStatusLabel(hit.legal_status));
    add("Published", hit.published_date);
    add("Updated", hit.updated_date);
    add("Effective", hit.effective_date);
  }

  return out;
}

function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

function buildSnapshot(
  tab: TabId,
  ranked: { hit: SearchHit; relevance: number }[],
  query: string,
  filters: Filters,
): ResultSnapshotItem[] {
  return ranked.slice(0, 50).map(({ hit, relevance }, index) => {
    const title = cardTitle(tab, hit);
    const path =
      detailHref(tab, hit, query, filters) ??
      `/?${buildSearchParams(tab, query, filters).toString()}`;
    const citation =
      typeof hit.citation === "string" ? hit.citation : undefined;
    const reference = typeof hit.act_id === "string" ? hit.act_id : undefined;
    const guidanceId =
      typeof hit.guidance_id === "string" ? hit.guidance_id : undefined;
    const id =
      citation ??
      reference ??
      guidanceId ??
      (typeof hit.id === "string" ? hit.id : undefined) ??
      (typeof hit.url === "string" ? hit.url : undefined) ??
      `${tab}:${title}`;
    return {
      id,
      rank: index + 1,
      title,
      path,
      citation,
      reference,
      score: Number.isFinite(relevance) ? relevance : undefined,
    };
  });
}

function cardTitle(tab: TabId, hit: SearchHit): string {
  if (tab === "judgments")
    return (
      (hit.title as string) ||
      (hit.neutral_cite as string) ||
      (hit.citation as string)
    );
  if (tab === "statutes")
    return (hit.short_title as string) || (hit.act_id as string);
  if (tab === "hansard")
    return (hit.topic as string) || (hit.speaker as string) || "Hansard record";
  if (tab === "bills")
    return (hit.title as string) || (hit.short_title as string) || "Bill";
  if (tab === "guidance") return (hit.title as string) || "Agency guidance";
  return (
    (hit.title as string) ||
    (hit.short_title as string) ||
    (hit.citation as string) ||
    "Result"
  );
}

interface MetaItem {
  key: string;
  node: React.ReactNode;
}

function cardMeta(tab: TabId, hit: SearchHit): MetaItem[] {
  const out: MetaItem[] = [];
  const tag = (key: string, label: string) =>
    out.push({
      key,
      node: (
        <span className="rounded bg-surface-2 px-1.5 py-0.5 font-medium text-muted">
          {label}
        </span>
      ),
    });
  const text = (key: string, value: unknown) =>
    out.push({ key, node: <span>{String(value)}</span> });

  if (tab === "judgments") {
    if (hit.court) tag("court", String(hit.court));
    if (hit.neutral_cite) text("cite", hit.neutral_cite);
    if (hit.decision_date) text("date", hit.decision_date);
  } else if (tab === "statutes") {
    if (hit.act_id) tag("act", String(hit.act_id));
    if (hit.kind) text("kind", hit.kind);
    if (hit.year_enacted) text("year", hit.year_enacted);
  } else if (tab === "hansard") {
    if (hit.speaker) text("speaker", hit.speaker);
    if (hit.party) tag("party", String(hit.party));
    if (hit.constituency) text("constituency", hit.constituency);
    if (hit.date) text("date", hit.date);
  } else if (tab === "bills") {
    if (hit.session) tag("session", String(hit.session));
    if (hit.status && String(hit.status).toLowerCase() !== "introduced") {
      text("status", hit.status);
    }
  } else if (tab === "guidance") {
    if (hit.agency) tag("agency", String(hit.agency));
    if (hit.document_kind) {
      text("document-kind", humanizeGuidanceKind(hit.document_kind));
    }
    tag("legal-status", guidanceLegalStatusLabel(hit.legal_status));
    if (hit.updated_date || hit.published_date) {
      text("date", hit.updated_date ?? hit.published_date);
    }
    if (hit.effective_date)
      text("effective", `Effective ${hit.effective_date}`);
  }
  return out;
}

function humanizeGuidanceKind(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const words = value.trim().replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Client-side rerank: the backend's BM25 score alone can rank a body-only
 * match at 100% (e.g. "unlawful assembly" → Building Control Act). Blend it
 * with how many query terms appear in the title and snippet so weak matches
 * read as weak.
 */
function rerankResults(
  tab: TabId,
  results: SearchHit[],
  query: string,
): { hit: SearchHit; relevance: number }[] {
  if (results.length === 0) return [];
  const terms = Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length >= 2),
    ),
  );
  const raw = results.map((r) => r.score);
  const max = Math.max(...raw);
  const min = Math.min(...raw);
  const span = max - min;
  const scored = results.map((hit) => {
    const backend = span > 0 ? (hit.score - min) / span : 0.5;
    const title = cardTitle(tab, hit).toLowerCase();
    const snippet = (hit.snippet ?? "").replace(/<[^>]+>/g, "").toLowerCase();
    const titleCover = terms.length
      ? terms.filter((t) => title.includes(t)).length / terms.length
      : 0;
    const snippetCover = terms.length
      ? terms.filter((t) => snippet.includes(t)).length / terms.length
      : 0;
    const relevance = 0.45 * backend + 0.4 * titleCover + 0.15 * snippetCover;
    return { hit, relevance };
  });
  scored.sort((a, b) => b.relevance - a.relevance);
  return scored;
}

function SkeletonList() {
  return (
    <ul className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          className="h-28 animate-pulse rounded-xl border border-border bg-surface"
        />
      ))}
    </ul>
  );
}

function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8V0C5.4 0 0 5.4 0 12h4z"
      />
    </svg>
  );
}
