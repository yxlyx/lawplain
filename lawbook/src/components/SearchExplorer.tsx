"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { SearchIcon, XIcon } from "@/components/icons";
import { ScoreBar } from "@/components/ScoreBar";
import { Snippet } from "@/components/Snippet";
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

const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;

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
}: {
  courts?: string[];
  initialTab?: string;
}) {
  const startTab = TABS.some((t) => t.id === initialTab)
    ? (initialTab as TabId)
    : "judgments";
  const [tab, setTab] = useState<TabId>(startTab);
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<Filters>({});
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  function selectTab(next: TabId) {
    if (next === tab) return;
    setTab(next);
    setFilters({});
    setData(null);
    setError(null);
  }

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

  const ranked = useMemo(
    () => rerankResults(tab, data?.results ?? [], data?.query ?? ""),
    [tab, data],
  );
  const hasQuery = q.trim().length >= MIN_CHARS;

  return (
    <section className="w-full">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-2" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={PLACEHOLDERS[tab]}
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

      <div className="mt-5">
        {!hasQuery && <Hint />}
        {hasQuery && error && (
          <div className="rounded-lg border border-border bg-surface p-5 text-sm text-muted">
            {error}
          </div>
        )}
        {hasQuery && !error && data && (
          <>
            <p className="mb-3 text-xs text-muted-2">
              {data.count >= 20
                ? "Top 20 results"
                : `${data.count} result${data.count === 1 ? "" : "s"}`}{" "}
              for{" "}
              <span className="font-semibold text-muted">
                &ldquo;{data.query}&rdquo;
              </span>
            </p>
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
                      fraction={relevance}
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
    <label className={`flex flex-col gap-1 ${className ?? ""}`}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">
        {label}
      </span>
      {children}
    </label>
  );
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
  if (tab === "judgments") {
    fields.push(
      <Field key="year" label="Year" className="w-44">
        <input
          value={filters.year_range ?? ""}
          onChange={(e) =>
            onChange({ year_range: e.target.value || undefined })
          }
          placeholder="2024 or 2018-2026"
          className={inputCls}
        />
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
  fraction,
}: {
  tab: TabId;
  hit: SearchHit;
  query: string;
  fraction: number;
}) {
  const href = detailHref(tab, hit, query);
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

  return href ? (
    <Link href={href} aria-label={title} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

function detailHref(tab: TabId, hit: SearchHit, query: string): string | null {
  // Carry the search query so the detail page can highlight and jump to matches.
  const qs = query ? `?q=${encodeURIComponent(query)}` : "";
  if (tab === "judgments" && typeof hit.citation === "string")
    return `/judgment/${encodeURIComponent(hit.citation)}${qs}`;
  if (tab === "statutes" && typeof hit.act_id === "string")
    return `/statute/${encodeURIComponent(hit.act_id)}`;
  return null;
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
    if (hit.status) text("status", hit.status);
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

function Hint() {
  return (
    <p className="px-6 pt-3 text-center text-sm leading-relaxed text-muted-2">
      Try <span className="font-medium text-muted">negligence duty care</span> —
      keywords are matched with AND.
    </p>
  );
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
