"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { SavedFeatureAuthPrompt } from "@/components/SavedFeatureAuthPrompt";
import { authClient } from "@/lib/auth-client";

type SavedAuthority = {
  id: string;
  docType: "judgment" | "statute";
  docId: string;
  title: string;
  path: string;
  updatedAt: number;
};

type SavedHighlight = {
  id: string;
  docType: "judgment" | "statute";
  docId: string;
  title: string;
  path: string;
  sectionId: string | null;
  selectedText: string;
  createdAt: number;
};

type ResultSnapshotItem = {
  id: string;
  rank: number;
  title: string;
  path: string;
  citation?: string;
  reference?: string;
  score?: number;
};

type SavedResultSet = {
  id: string;
  name: string;
  tab: string;
  query: string;
  filters: Record<string, string>;
  resultCount: number;
  results: ResultSnapshotItem[];
  createdAt: number;
  updatedAt: number;
};

function formatDate(ts: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(ts));
}

function compareResultSets(left?: SavedResultSet, right?: SavedResultSet) {
  if (!left || !right) return null;
  const leftById = new Map(left.results.map((item) => [item.id, item]));
  const rightById = new Map(right.results.map((item) => [item.id, item]));
  const overlap = left.results.filter((item) => rightById.has(item.id));
  const added = right.results.filter((item) => !leftById.has(item.id));
  const removed = left.results.filter((item) => !rightById.has(item.id));
  const rankDeltas = overlap.map((item) => {
    const other = rightById.get(item.id);
    return {
      id: item.id,
      title: other?.title ?? item.title,
      leftRank: item.rank,
      rightRank: other?.rank ?? item.rank,
      delta: (other?.rank ?? item.rank) - item.rank,
    };
  });
  return { overlap, added, removed, rankDeltas };
}

export function SavedWorkspace() {
  const { data: session, isPending } = authClient.useSession();
  const [authorities, setAuthorities] = useState<SavedAuthority[]>([]);
  const [highlights, setHighlights] = useState<SavedHighlight[]>([]);
  const [resultSets, setResultSets] = useState<SavedResultSet[]>([]);
  const [leftResultSetId, setLeftResultSetId] = useState("");
  const [rightResultSetId, setRightResultSetId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);

  useEffect(() => {
    if (!session?.user) {
      setAuthorities([]);
      setHighlights([]);
      setResultSets([]);
      setError(null);
      setLoading(false);
      setAuthRequired(false);
      return;
    }
    let ignore = false;

    async function loadSaved() {
      setLoading(true);
      setError(null);
      setAuthRequired(false);
      try {
        const [savedResult, highlightsResult, resultSetsResult] =
          await Promise.allSettled([
            fetch("/api/saved", { cache: "no-store" }),
            fetch("/api/highlights", { cache: "no-store" }),
            fetch("/api/result-sets?limit=100", { cache: "no-store" }),
          ]);

        const savedRes =
          savedResult.status === "fulfilled" ? savedResult.value : null;
        const highlightsRes =
          highlightsResult.status === "fulfilled"
            ? highlightsResult.value
            : null;
        const resultSetsRes =
          resultSetsResult.status === "fulfilled"
            ? resultSetsResult.value
            : null;

        if (
          savedRes?.status === 401 ||
          highlightsRes?.status === 401 ||
          resultSetsRes?.status === 401
        ) {
          if (!ignore) {
            setAuthorities([]);
            setHighlights([]);
            setResultSets([]);
            setAuthRequired(true);
          }
          return;
        }

        if (savedRes?.ok) {
          const savedData = (await savedRes.json()) as {
            authorities?: SavedAuthority[];
          };
          if (!ignore) setAuthorities(savedData.authorities ?? []);
        } else if (!ignore) {
          setAuthorities([]);
          setError(
            "Could not load saved documents. If you just added Saved, run the D1 migrations and refresh.",
          );
        }

        if (highlightsRes?.ok) {
          const highlightData = (await highlightsRes.json()) as {
            highlights?: SavedHighlight[];
          };
          if (!ignore) setHighlights(highlightData.highlights ?? []);
        } else if (!ignore) {
          setHighlights([]);
          setError(
            (current) =>
              current ??
              "Saved documents loaded, but highlights could not load.",
          );
        }

        if (resultSetsRes?.ok) {
          const resultSetData = (await resultSetsRes.json()) as {
            resultSets?: SavedResultSet[];
          };
          if (!ignore) setResultSets(resultSetData.resultSets ?? []);
        } else if (!ignore) {
          setResultSets([]);
          setError(
            (current) =>
              current ??
              "Saved documents loaded, but result sets could not load.",
          );
        }
      } catch (err) {
        if (!ignore) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not load saved research.",
          );
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    void loadSaved();

    return () => {
      ignore = true;
    };
  }, [session?.user]);

  const leftResultSet = resultSets.find((set) => set.id === leftResultSetId);
  const rightCandidates = leftResultSet
    ? resultSets.filter(
        (set) => set.id !== leftResultSet.id && set.tab === leftResultSet.tab,
      )
    : resultSets;
  const rightResultSet = resultSets.find((set) => set.id === rightResultSetId);
  const comparison = useMemo(
    () => compareResultSets(leftResultSet, rightResultSet),
    [leftResultSet, rightResultSet],
  );

  useEffect(() => {
    if (!leftResultSet || !rightResultSet) return;
    if (
      leftResultSet.id === rightResultSet.id ||
      leftResultSet.tab !== rightResultSet.tab
    ) {
      setRightResultSetId("");
    }
  }, [leftResultSet, rightResultSet]);

  async function deleteResultSet(id: string) {
    const previous = resultSets;
    setResultSets((sets) => sets.filter((set) => set.id !== id));
    if (leftResultSetId === id) setLeftResultSetId("");
    if (rightResultSetId === id) setRightResultSetId("");
    const res = await fetch(`/api/result-sets/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).catch(() => null);
    if (!res?.ok) {
      setResultSets(previous);
      setError("Could not delete that result set. Please try again.");
    }
  }

  if (isPending) {
    return (
      <p className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted">
        Loading saved workspace…
      </p>
    );
  }

  if (!session?.user || authRequired) {
    return (
      <SavedFeatureAuthPrompt
        next="/saved"
        title="Sign in or create an account to use Saved"
        body="Saved research is private to your account. Sign in or create an account to keep judgments, statutes, highlights, and result sets."
      />
    );
  }

  if (loading) {
    return (
      <p className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted">
        Loading saved workspace…
      </p>
    );
  }

  const empty =
    authorities.length === 0 &&
    highlights.length === 0 &&
    resultSets.length === 0;

  if (error && empty) {
    return (
      <div className="rounded-2xl border border-red-100 bg-red-50 p-6 text-sm text-red-700">
        <p>{error}</p>
        <p className="mt-2 text-red-700/80">
          If this is local/dev, run the saved-workspace and search-history D1
          migrations, then try saving again.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
      {error && (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 lg:col-span-2">
          {error}
        </p>
      )}

      <section className="rounded-2xl border border-border bg-surface p-5 lg:col-span-2">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-xl font-medium text-foreground">
              Result sets
            </h2>
            <p className="mt-1 text-sm text-muted">
              Saved search snapshots live here. Pick two from the same corpus to
              compare rankings.
            </p>
          </div>
          <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted-2">
            {resultSets.length}
          </span>
        </div>

        {resultSets.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-strong p-5 text-sm text-muted">
            <p className="font-medium text-foreground">No result sets yet.</p>
            <p className="mt-1">
              Run a search, choose “Save result set”, then compare snapshots
              here.
            </p>
            <Link
              href="/"
              className="mt-3 inline-flex rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted transition-colors hover:border-accent hover:text-accent"
            >
              Go to search
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
            <ul className="space-y-3">
              {resultSets.map((set) => (
                <li
                  key={set.id}
                  className="rounded-xl border border-border bg-background p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-2">
                        <span>{set.tab}</span>
                        <span>{set.resultCount} results</span>
                        <span>Saved {formatDate(set.updatedAt)}</span>
                      </div>
                      <h3 className="mt-1 font-serif text-lg font-medium leading-snug text-foreground">
                        {set.name}
                      </h3>
                      <p className="mt-1 text-sm text-muted">
                        Search: “{set.query}”
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteResultSet(set.id)}
                      className="text-xs font-medium text-muted-2 transition-colors hover:text-red-700"
                    >
                      Delete
                    </button>
                  </div>
                  {set.results.length > 0 && (
                    <ol className="mt-3 space-y-1.5 text-sm">
                      {set.results.slice(0, 3).map((item) => (
                        <li key={item.id} className="flex gap-2 text-muted">
                          <span className="font-mono text-xs text-muted-2">
                            #{item.rank}
                          </span>
                          <Link
                            href={item.path}
                            className="truncate font-medium text-foreground hover:text-accent"
                          >
                            {item.title}
                          </Link>
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              ))}
            </ul>

            <aside className="rounded-xl border border-border bg-surface-2/50 p-4">
              <h3 className="font-serif text-lg font-medium text-foreground">
                Compare result sets
              </h3>
              <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-muted-2">
                First set
                <select
                  value={leftResultSetId}
                  onChange={(event) => {
                    setLeftResultSetId(event.target.value);
                    setRightResultSetId("");
                  }}
                  className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm font-normal normal-case tracking-normal text-foreground outline-none focus:border-ring"
                >
                  <option value="">Choose a result set</option>
                  {resultSets.map((set) => (
                    <option key={set.id} value={set.id}>
                      {set.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-muted-2">
                Second set
                <select
                  value={rightResultSetId}
                  onChange={(event) => setRightResultSetId(event.target.value)}
                  disabled={!leftResultSet}
                  className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm font-normal normal-case tracking-normal text-foreground outline-none focus:border-ring disabled:opacity-50"
                >
                  <option value="">Choose a matching set</option>
                  {rightCandidates.map((set) => (
                    <option key={set.id} value={set.id}>
                      {set.name}
                    </option>
                  ))}
                </select>
              </label>

              {leftResultSet && rightCandidates.length === 0 && (
                <p className="mt-3 text-xs leading-5 text-muted">
                  Save another {leftResultSet.tab} result set to compare against
                  this one.
                </p>
              )}

              {comparison && (
                <div className="mt-4 space-y-3 text-sm text-muted">
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="rounded-lg bg-surface px-2 py-2">
                      <span className="block font-semibold text-foreground">
                        {comparison.overlap.length}
                      </span>
                      overlap
                    </div>
                    <div className="rounded-lg bg-surface px-2 py-2">
                      <span className="block font-semibold text-foreground">
                        {comparison.added.length}
                      </span>
                      added
                    </div>
                    <div className="rounded-lg bg-surface px-2 py-2">
                      <span className="block font-semibold text-foreground">
                        {comparison.removed.length}
                      </span>
                      removed
                    </div>
                  </div>
                  {comparison.rankDeltas.slice(0, 8).map((delta) => (
                    <div
                      key={delta.id}
                      className="flex items-center justify-between gap-3 rounded-lg bg-surface px-2.5 py-1.5 text-xs"
                    >
                      <span className="truncate">{delta.title}</span>
                      <span className="shrink-0 font-medium text-muted-2">
                        #{delta.leftRank} → #{delta.rightRank}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </aside>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-serif text-xl font-medium text-foreground">
            Saved documents
          </h2>
          <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted-2">
            {authorities.length}
          </span>
        </div>
        {authorities.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-strong p-5 text-sm text-muted">
            <p className="font-medium text-foreground">Nothing saved yet.</p>
            <p className="mt-1">
              Save a judgment or statute and it will appear here.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href="/?tab=judgments"
                className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted transition-colors hover:border-accent hover:text-accent"
              >
                Search judgments
              </Link>
              <Link
                href="/?tab=statutes"
                className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted transition-colors hover:border-accent hover:text-accent"
              >
                Search statutes
              </Link>
            </div>
          </div>
        ) : (
          <ul className="space-y-3">
            {authorities.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.path}
                  className="block rounded-xl border border-border bg-background p-4 transition-colors hover:border-border-strong hover:bg-surface-2"
                >
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">
                    {item.docType}
                  </span>
                  <span className="mt-1 block font-serif text-lg font-medium leading-snug text-foreground">
                    {item.title}
                  </span>
                  <span className="mt-2 block text-xs text-muted-2">
                    Saved {formatDate(item.updatedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-serif text-xl font-medium text-foreground">
            Highlights
          </h2>
          <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted-2">
            {highlights.length}
          </span>
        </div>
        {highlights.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-strong p-5 text-sm text-muted">
            <p className="font-medium text-foreground">No highlights yet.</p>
            <p className="mt-1">
              Select text inside a judgment or statute, then choose “Save
              selected text”.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {highlights.map((item) => (
              <li
                key={item.id}
                className="rounded-xl border border-border bg-background p-4"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-2">
                  <span>{item.docType}</span>
                  {item.sectionId && <span>§ {item.sectionId}</span>}
                  <span>{formatDate(item.createdAt)}</span>
                </div>
                <blockquote className="border-l-2 border-accent pl-3 text-sm leading-6 text-foreground/90">
                  {item.selectedText}
                </blockquote>
                <Link
                  href={item.path}
                  className="mt-3 inline-flex text-sm font-medium text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent"
                >
                  Open {item.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {empty && (
        <p className="rounded-2xl border border-border bg-surface-2/50 p-5 text-center text-sm text-muted lg:col-span-2">
          Nothing saved yet — this page will fill up once you save documents,
          highlights, or result sets.
        </p>
      )}
    </div>
  );
}
