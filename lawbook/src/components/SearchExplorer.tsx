"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { SearchIcon, XIcon } from "@/components/icons";
import { ScoreBar } from "@/components/ScoreBar";
import { Snippet } from "@/components/Snippet";
import {
  ApiError,
  relevanceFraction,
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
  status?: string;
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
      return sgjudge.searchBills(q, { status: f.status, limit: 20 }, init);
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

  const scores = useMemo(
    () => (data?.results ?? []).map((r) => r.score),
    [data],
  );
  const hasQuery = q.trim().length >= MIN_CHARS;

  return (
    <section className="w-full">
      <div className="-mx-1 mb-4 flex gap-1 overflow-x-auto pb-1 thin-scroll">
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => selectTab(t.id)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-primary text-primary-fg"
                  : "border border-border text-muted hover:border-border-strong hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-2" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={PLACEHOLDERS[tab]}
          autoComplete="off"
          spellCheck={false}
          className="h-14 w-full rounded-xl border border-border-strong bg-surface pl-12 pr-12 text-base text-foreground shadow-sm outline-none transition-shadow placeholder:text-muted-2 focus:border-ring focus:ring-4 focus:ring-ring/15"
        />
        {loading && (
          <Spinner className="absolute right-11 top-1/2 h-5 w-5 -translate-y-1/2 text-accent" />
        )}
        {q && (
          <button
            type="button"
            onClick={() => setQ("")}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-2 transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <XIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      <FilterRow
        tab={tab}
        courts={courts}
        filters={filters}
        onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
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
              {data.count} result{data.count === 1 ? "" : "s"} for{" "}
              <span className="font-medium text-muted">
                &ldquo;{data.query}&rdquo;
              </span>
            </p>
            {data.results.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border-strong bg-surface p-8 text-center text-sm text-muted">
                No matches. Try broader keywords or remove a filter.
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {data.results.map((r, i) => (
                  <li key={(r.citation as string) ?? (r.act_id as string) ?? i}>
                    <ResultCard
                      tab={tab}
                      hit={r}
                      fraction={relevanceFraction(r.score, scores)}
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

function FilterRow({
  tab,
  courts,
  filters,
  onChange,
}: {
  tab: TabId;
  courts: string[];
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
}) {
  const inputCls =
    "h-9 rounded-lg border border-border bg-surface px-3 text-sm text-foreground outline-none placeholder:text-muted-2 focus:border-ring focus:ring-2 focus:ring-ring/15";
  const items: React.ReactNode[] = [];

  if (tab === "judgments" || tab === "practice") {
    items.push(
      <select
        key="court"
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
      </select>,
    );
  }
  if (tab === "judgments") {
    items.push(
      <input
        key="year"
        value={filters.year_range ?? ""}
        onChange={(e) => onChange({ year_range: e.target.value || undefined })}
        placeholder="Year e.g. 2024 or 2018-2026"
        className={`${inputCls} w-52`}
      />,
      <input
        key="judge"
        value={filters.judge ?? ""}
        onChange={(e) => onChange({ judge: e.target.value || undefined })}
        placeholder="Judge"
        className={`${inputCls} w-36`}
      />,
    );
  }
  if (tab === "statutes") {
    items.push(
      <select
        key="kind"
        value={filters.kind ?? ""}
        onChange={(e) => onChange({ kind: e.target.value || undefined })}
        className={inputCls}
      >
        <option value="">All kinds</option>
        <option value="act_current">Act (current)</option>
        <option value="act_repealed">Act (repealed)</option>
      </select>,
    );
  }
  if (tab === "hansard") {
    items.push(
      <input
        key="speaker"
        value={filters.speaker ?? ""}
        onChange={(e) => onChange({ speaker: e.target.value || undefined })}
        placeholder="Speaker"
        className={`${inputCls} w-40`}
      />,
      <input
        key="since"
        type="date"
        value={filters.since ?? ""}
        onChange={(e) => onChange({ since: e.target.value || undefined })}
        className={inputCls}
      />,
    );
  }
  if (tab === "bills") {
    items.push(
      <input
        key="status"
        value={filters.status ?? ""}
        onChange={(e) => onChange({ status: e.target.value || undefined })}
        placeholder="Status"
        className={`${inputCls} w-40`}
      />,
    );
  }

  if (items.length === 0) return null;
  return <div className="mt-3 flex flex-wrap items-center gap-2">{items}</div>;
}

function ResultCard({
  tab,
  hit,
  fraction,
}: {
  tab: TabId;
  hit: SearchHit;
  fraction: number;
}) {
  const href = detailHref(tab, hit);
  const title = cardTitle(tab, hit);
  const meta = cardMeta(tab, hit);

  const inner = (
    <article className="group rounded-xl border border-border bg-surface p-5 transition-all hover:border-border-strong hover:shadow-md">
      <div className="mb-1.5 flex items-start justify-between gap-4">
        <h3 className="font-serif text-lg font-semibold leading-snug text-foreground group-hover:text-accent">
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
    <Link href={href} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

function detailHref(tab: TabId, hit: SearchHit): string | null {
  if (tab === "judgments" && typeof hit.citation === "string")
    return `/judgment/${encodeURIComponent(hit.citation)}`;
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

function Hint() {
  return (
    <div className="rounded-xl border border-dashed border-border-strong bg-surface/60 p-8 text-center">
      <p className="text-sm text-muted">
        Type at least two characters to search. Keywords are matched with AND —
        e.g.{" "}
        <span className="font-medium text-foreground">
          negligence duty care
        </span>{" "}
        finds documents containing all three.
      </p>
    </div>
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
