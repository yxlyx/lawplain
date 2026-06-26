"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SearchIcon, XIcon } from "@/components/icons";
import { ScoreBar } from "@/components/ScoreBar";
import { Snippet } from "@/components/Snippet";
import { authClient } from "@/lib/auth-client";
import {
  ApiError,
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
  | "practice";

const TABS: { id: TabId; label: string }[] = [
  { id: "judgments", label: "Judgments" },
  { id: "statutes", label: "Statutes" },
  { id: "hansard", label: "Hansard" },
  { id: "bills", label: "Bills" },
  { id: "subsidiary", label: "Subsidiary Leg." },
  { id: "practice", label: "Practice Dir." },
];

const PLACEHOLDERS: Record<TabId, string> = {
  judgments: "e.g. negligence duty of care",
  statutes: "e.g. unlawful assembly",
  hansard: "e.g. housing affordability",
  bills: "e.g. data protection",
  subsidiary: "e.g. traffic regulations",
  practice: "e.g. electronic filing",
};

interface Filters {
  court?: string;
  year_range?: string;
  judge?: string;
  kind?: string;
  speaker?: string;
  since?: string;
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
const MIN_CHARS = 2;
const FILTER_KEYS: (keyof Filters)[] = [
  "court",
  "year_range",
  "judge",
  "kind",
  "speaker",
  "since",
];

function filtersFromSearchParams(params: {
  get(name: string): string | null;
}): Filters {
  const filters: Filters = {};
  for (const key of FILTER_KEYS) {
    const value = params.get(key)?.trim();
    if (value) filters[key] = value;
  }
  return filters;
}

function buildSearchParams(
  tab: TabId,
  query: string,
  filters: Filters,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("tab", tab);
  const cleanQuery = query.trim();
  if (cleanQuery) params.set("q", cleanQuery);
  for (const key of FILTER_KEYS) {
    const value = filters[key]?.trim();
    if (value) params.set(key, value);
  }
  return params;
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
  }
}

export function SearchExplorer({
  courts = [],
  initialTab = "judgments",
  initialQuery = "",
}: {
  courts?: string[];
  initialTab?: string;
  initialQuery?: string;
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
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentSearches, setRecentSearches] = useState<SearchHistoryEntry[]>(
    [],
  );
  const [savingResultSet, setSavingResultSet] = useState(false);
  const [showSaveResultSetForm, setShowSaveResultSetForm] = useState(false);
  const [resultSetName, setResultSetName] = useState("");
  const [saveResultSetMessage, setSaveResultSetMessage] = useState<
    string | null
  >(null);
  const seq = useRef(0);
  const lastRecorded = useRef("");
  const { data: session } = authClient.useSession();
  const isSignedIn = Boolean(session?.user);

  function selectTab(next: TabId) {
    if (next === tab) return;
    setTab(next);
    setFilters({});
    setData(null);
    setError(null);
  }

  useEffect(() => {
    const params = buildSearchParams(tab, q, filters);
    const next = `/?${params.toString()}`;
    if (
      window.location.pathname === "/" &&
      `${window.location.pathname}${window.location.search}` !== next
    ) {
      router.replace(next, { scroll: false });
    }
  }, [tab, q, filters, router]);

  useEffect(() => {
    const query = q.trim();
    if (query.length < MIN_CHARS) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    const id = ++seq.current;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await runSearch(tab, query, filters, controller.signal);
        if (id === seq.current) setData(res);
      } catch (err) {
        if (controller.signal.aborted) return;
        if (id === seq.current) {
          setData(null);
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
  }, [q, tab, filters]);

  useEffect(() => {
    if (!isSignedIn) {
      setRecentSearches([]);
      return;
    }
    let cancelled = false;
    fetch("/api/search-history?limit=10")
      .then(async (res) =>
        res.ok
          ? ((await res.json()) as { searches?: SearchHistoryEntry[] })
          : null,
      )
      .then((payload) => {
        if (!cancelled) setRecentSearches(payload?.searches ?? []);
      })
      .catch(() => {
        if (!cancelled) setRecentSearches([]);
      });
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

    const searchesRes = await fetch("/api/search-history?limit=10").catch(
      () => null,
    );
    if (!searchesRes?.ok) return;
    const searches = (await searchesRes.json().catch(() => null)) as {
      searches?: SearchHistoryEntry[];
    } | null;
    setRecentSearches(searches?.searches ?? []);
  }, [isSignedIn, data, error, tab, filters, currentSnapshot]);

  function openSaveResultSetForm() {
    if (!data) return;
    setResultSetName(
      `${TABS.find((t) => t.id === tab)?.label ?? "Search"}: ${data.query}`.slice(
        0,
        80,
      ),
    );
    setSaveResultSetMessage(null);
    setShowSaveResultSetForm(true);
  }

  async function handleSaveResultSet() {
    if (!data || currentSnapshot.length === 0 || savingResultSet) return;
    const name = resultSetName.trim();
    if (!name) {
      setSaveResultSetMessage("Please name this result set.");
      return;
    }
    setSavingResultSet(true);
    setSaveResultSetMessage(null);
    try {
      const res = await fetch("/api/result-sets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          tab,
          query: data.query,
          filters,
          resultCount: data.count,
          results: currentSnapshot.slice(0, 50),
        }),
      });
      if (res.status === 401) {
        setSaveResultSetMessage("Sign in again to save result sets.");
        return;
      }
      if (!res.ok) throw new Error("Unable to save result set");
      setShowSaveResultSetForm(false);
      setResultSetName("");
      setSaveResultSetMessage("Result set saved. Compare it from Saved.");
    } catch {
      setSaveResultSetMessage(
        "Could not save this result set. Please try again.",
      );
    } finally {
      setSavingResultSet(false);
    }
  }

  return (
    <section className="w-full">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-2" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
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

      <div className="mt-4 flex flex-wrap justify-center gap-1.5">
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => selectTab(t.id)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm transition-colors ${
                active
                  ? "bg-accent-soft font-medium text-accent"
                  : "text-muted hover:bg-surface-2 hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <FilterRow
        tab={tab}
        courts={courts}
        filters={filters}
        onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
        onClear={() => setFilters({})}
      />

      {isSignedIn && recentSearches.length > 0 && (
        <section className="mt-4 rounded-2xl border border-border bg-surface-2/40 px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-foreground">
              Recent searches
            </h2>
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
          <div className="flex flex-wrap gap-2">
            {recentSearches.map((entry) => (
              <button
                key={entry.id}
                type="button"
                title={`${entry.resultCount} result${entry.resultCount === 1 ? "" : "s"}`}
                onClick={() => {
                  setTab(entry.tab);
                  setQ(entry.query);
                  setFilters(entry.filters);
                  setData(null);
                  setError(null);
                }}
                className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-muted transition-colors hover:border-accent hover:text-accent"
              >
                <span className="font-medium">
                  {TABS.find((t) => t.id === entry.tab)?.label}
                </span>
                <span className="mx-1 text-muted-2">·</span>
                {entry.query}
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="mt-5">
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
                {isSignedIn ? (
                  <button
                    type="button"
                    onClick={openSaveResultSetForm}
                    disabled={currentSnapshot.length === 0}
                    className="rounded-lg border border-accent/40 bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:border-accent hover:bg-accent hover:text-primary-fg disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Save result set
                  </button>
                ) : (
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-2">
                    <span>To save and compare result sets,</span>
                    <Link
                      href="/sign-in?next=%2F"
                      className="font-medium text-accent hover:underline"
                    >
                      sign in
                    </Link>
                    <span>or</span>
                    <Link
                      href="/sign-up?next=%2F"
                      className="font-medium text-accent hover:underline"
                    >
                      create account
                    </Link>
                    <span>.</span>
                  </span>
                )}
              </div>

              {saveResultSetMessage && !showSaveResultSetForm && (
                <div className="rounded-xl border border-border bg-surface-2/70 px-3 py-2 text-xs text-muted">
                  {saveResultSetMessage}
                </div>
              )}

              {showSaveResultSetForm && (
                <form
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-2/70 px-3 py-2 text-xs text-muted"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleSaveResultSet();
                  }}
                >
                  <input
                    value={resultSetName}
                    onChange={(event) => setResultSetName(event.target.value)}
                    className="h-8 min-w-64 rounded-lg border border-border bg-surface px-2 text-xs text-foreground outline-none focus:border-ring"
                    aria-label="Result set name"
                  />
                  <button
                    type="submit"
                    disabled={savingResultSet}
                    className="rounded-lg border border-accent/40 bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:border-accent hover:bg-accent hover:text-primary-fg disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {savingResultSet ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowSaveResultSetForm(false);
                      setSaveResultSetMessage(null);
                    }}
                    className="px-2 py-1 text-xs font-medium text-muted-2 transition-colors hover:text-foreground"
                  >
                    Cancel
                  </button>
                  {saveResultSetMessage && (
                    <span className="basis-full text-muted">
                      {saveResultSetMessage}
                    </span>
                  )}
                </form>
              )}
            </div>
            {data.results.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border-strong bg-surface p-8 text-center text-sm text-muted">
                No matches. Try broader keywords or remove a filter.
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {ranked.map(({ hit, relevance }, i) => (
                  <li
                    key={
                      (hit.citation as string) ?? (hit.act_id as string) ?? i
                    }
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
    </section>
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
          value={filters.speaker ?? ""}
          onChange={(e) => onChange({ speaker: e.target.value || undefined })}
          placeholder="Speaker name"
          className={inputCls}
        />
      </Field>,
      <Field key="since" label="On or after">
        <input
          type="date"
          value={filters.since ?? ""}
          onChange={(e) => onChange({ since: e.target.value || undefined })}
          className={inputCls}
        />
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
    const id =
      citation ??
      reference ??
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
  }
  return out;
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
