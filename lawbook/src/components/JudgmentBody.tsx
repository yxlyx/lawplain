"use client";

import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { SectionNav, type SectionNavItem } from "@/components/SectionNav";
import { useSectionEngagement } from "@/hooks/useSectionEngagement";
import {
  type Block,
  buildRegex,
  extractSections,
  parseBlocks,
  parseTerms,
} from "@/lib/sections";
import { ApiError, sgjudge } from "@/lib/sgjudge";

const PAGE = 60000;

interface Suggestion {
  count: number;
  badge?: string;
}

/**
 * Renders judgment body text with a "load more" control. Bodies can be large,
 * so the API paginates via `body_offset`/`body_length`; we append each chunk.
 *
 * Detected heading blocks get stable anchors and power section navigation. When
 * a search term is present, anonymous engagement (section dwell + match
 * navigator landings) is logged behind consent/DNT and popular sections are
 * badged/promoted from `/api/suggestions`.
 */
export function JudgmentBody({
  citation,
  initialText,
  initialLoaded,
  total,
  query,
}: {
  citation: string;
  initialText: string;
  initialLoaded: number; // chars already loaded (offset + initial length)
  total: number;
  query: string;
}) {
  const [text, setText] = useState(initialText);
  const [loaded, setLoaded] = useState(initialLoaded);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLElement>(null);
  const autoLoads = useRef(0);
  const [active, setActive] = useState(0);
  const [suggestions, setSuggestions] = useState<Map<string, Suggestion>>(
    new Map(),
  );

  const hasMore = loaded < total;
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 100;

  const terms = useMemo(() => parseTerms(query), [query]);
  const regex = useMemo(() => buildRegex(terms), [terms]);
  const blocks = useMemo(() => parseBlocks(text), [text]);
  const sections = useMemo(() => extractSections(text), [text]);
  const { logActiveMatch } = useSectionEngagement({
    containerRef,
    docType: "judgment",
    docId: citation,
    terms,
    contentKey: loaded,
  });

  // Derive match count from the same parse the renderer uses, so it stays in
  // sync with the <mark> elements without a DOM-counting effect.
  const matchCount = useMemo(() => {
    if (!regex) return 0;
    let count = 0;
    for (const block of blocks) {
      count += block.body.match(regex)?.length ?? 0;
    }
    return count;
  }, [blocks, regex]);
  const activeIndex = matchCount === 0 ? 0 : Math.min(active, matchCount - 1);

  const loadMore = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await sgjudge.getJudgment(citation, {
        include_body: true,
        body_offset: loaded,
        body_length: PAGE,
      });
      const chunk = (res.body_text as string) ?? "";
      setText((t) => t + chunk);
      setLoaded((l) => l + chunk.length);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.status} — ${err.message}`
          : "Could not load more text.",
      );
    } finally {
      setLoading(false);
    }
  }, [citation, loaded]);

  // Keep loading further chunks until the first match appears (bounded).
  useEffect(() => {
    if (
      terms.length > 0 &&
      matchCount === 0 &&
      hasMore &&
      !loading &&
      autoLoads.current < 40
    ) {
      autoLoads.current += 1;
      loadMore();
    }
  }, [terms, matchCount, hasMore, loading, loadMore]);

  // Fetch aggregate suggestions per active term once a query is present, and
  // merge counts across terms by section. Only ranked above-threshold sections
  // come back, so anything here is safe to badge/promote.
  useEffect(() => {
    if (terms.length === 0) {
      setSuggestions(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      const merged = new Map<string, number>();
      await Promise.all(
        terms.map(async (term) => {
          try {
            const res = await fetch(
              `/api/suggestions?docType=judgment&docId=${encodeURIComponent(
                citation,
              )}&term=${encodeURIComponent(term)}`,
            );
            if (!res.ok) return;
            const data = (await res.json()) as {
              sections?: { sectionId: string; count: number }[];
            };
            for (const s of data.sections ?? []) {
              merged.set(s.sectionId, (merged.get(s.sectionId) ?? 0) + s.count);
            }
          } catch {
            // Suggestions are an enhancement; ignore failures.
          }
        }),
      );
      if (cancelled) return;
      const top = Math.max(0, ...merged.values());
      const label = query.trim()
        ? `Most viewed for '${query.trim()}'`
        : "Most viewed";
      const next = new Map<string, Suggestion>();
      for (const [sectionId, count] of merged) {
        next.set(sectionId, {
          count,
          badge: count === top && top > 0 ? label : undefined,
        });
      }
      setSuggestions(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [terms, citation, query]);

  // Scroll the active match into view and flag it for styling.
  useEffect(() => {
    if (matchCount === 0) return;
    const el = containerRef.current;
    if (!el) return;
    const marks = el.querySelectorAll<HTMLElement>("mark[data-match]");
    marks.forEach((m, i) => {
      if (i === activeIndex) m.setAttribute("data-active", "");
      else m.removeAttribute("data-active");
    });
    marks[activeIndex]?.scrollIntoView({ behavior: "smooth", block: "center" });
    logActiveMatch();
  }, [activeIndex, matchCount, logActiveMatch]);

  const goMatch = (dir: number) => {
    if (matchCount === 0) return;
    setActive((a) => {
      const cur = Math.min(a, matchCount - 1);
      return (cur + dir + matchCount) % matchCount;
    });
  };

  // Build nav items: suggested sections (with count/badge) float to the top in
  // popularity order, the rest follow in document order.
  const navItems = useMemo<SectionNavItem[]>(() => {
    const promoted: SectionNavItem[] = [];
    const rest: SectionNavItem[] = [];
    for (const s of sections) {
      const sug = suggestions.get(s.id);
      if (sug) {
        promoted.push({
          id: s.id,
          label: s.label,
          count: sug.count,
          badge: sug.badge,
        });
      } else {
        rest.push({ id: s.id, label: s.label });
      }
    }
    promoted.sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
    return [...promoted, ...rest];
  }, [sections, suggestions]);

  const searching =
    terms.length > 0 && matchCount === 0 && (loading || hasMore);

  return (
    <div className="lg:grid lg:grid-cols-[1fr_15rem] lg:gap-8">
      <div className="min-w-0">
        {terms.length > 0 && (
          <div className="sticky top-16 z-10 mb-4 flex items-center justify-between gap-3 rounded-lg border border-border bg-surface/95 px-4 py-2.5 text-sm shadow-sm backdrop-blur">
            <span className="min-w-0 truncate text-muted">
              {matchCount > 0 ? (
                <>
                  <span className="font-medium text-foreground">
                    {matchCount}
                  </span>{" "}
                  match{matchCount === 1 ? "" : "es"} for{" "}
                  <span className="font-medium text-foreground">
                    &ldquo;{query}&rdquo;
                  </span>
                </>
              ) : searching ? (
                "Searching the judgment…"
              ) : (
                <>No matches for &ldquo;{query}&rdquo; in this judgment.</>
              )}
            </span>
            {matchCount > 0 && (
              <div className="flex shrink-0 items-center gap-1">
                <span className="mr-1 tabular-nums text-muted-2">
                  {activeIndex + 1}/{matchCount}
                </span>
                <button
                  type="button"
                  onClick={() => goMatch(-1)}
                  aria-label="Previous match"
                  className="rounded-md border border-border px-2 py-1 leading-none text-muted transition-colors hover:border-border-strong hover:text-foreground"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => goMatch(1)}
                  aria-label="Next match"
                  className="rounded-md border border-border px-2 py-1 leading-none text-muted transition-colors hover:border-border-strong hover:text-foreground"
                >
                  ↓
                </button>
              </div>
            )}
          </div>
        )}

        {navItems.length > 1 && (
          <div className="mb-4 lg:hidden">
            <SectionNav items={navItems} />
          </div>
        )}

        <article
          ref={containerRef}
          className="flex max-w-[68ch] flex-col gap-4 font-serif text-[17px] leading-7 text-foreground/90"
        >
          {renderJudgment(blocks, regex)}
        </article>

        {error && <p className="mt-4 text-sm text-accent">{error}</p>}

        {hasMore ? (
          <div className="mt-8 flex flex-col items-center gap-3 border-t border-border pt-6">
            <div className="h-1.5 w-full max-w-md overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-xs text-muted-2">
              Showing {loaded.toLocaleString()} of {total.toLocaleString()}{" "}
              characters
            </p>
            <button
              type="button"
              onClick={loadMore}
              disabled={loading}
              className="rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-fg transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {loading ? "Loading…" : "Load more"}
            </button>
          </div>
        ) : (
          <p className="mt-8 border-t border-border pt-6 text-center text-xs text-muted-2">
            End of judgment · {total.toLocaleString()} characters
          </p>
        )}
      </div>

      {navItems.length > 1 && (
        <aside className="hidden lg:block">
          <SectionNav items={navItems} />
        </aside>
      )}
    </div>
  );
}

/** Wrap query-term occurrences within a text block in <mark> elements. */
function highlight(
  text: string,
  regex: RegExp | null,
  keyBase: string,
): ReactNode {
  if (!regex) return text;
  const out: ReactNode[] = [];
  let last = 0;
  regex.lastIndex = 0;
  let m = regex.exec(text);
  while (m !== null) {
    const start = m.index;
    if (start > last) {
      out.push(
        <Fragment key={`${keyBase}:t${last}`}>
          {text.slice(last, start)}
        </Fragment>,
      );
    }
    out.push(
      <mark key={`${keyBase}:m${start}`} data-match>
        {m[0]}
      </mark>,
    );
    last = start + m[0].length;
    if (m[0].length === 0) regex.lastIndex += 1;
    m = regex.exec(text);
  }
  if (out.length === 0) return text;
  if (last < text.length) {
    out.push(<Fragment key={`${keyBase}:tEnd`}>{text.slice(last)}</Fragment>);
  }
  return out;
}

function renderJudgment(blocks: Block[], regex: RegExp | null) {
  let currentSection: string | undefined;
  return blocks.map((b) => {
    if (b.kind === "heading") {
      currentSection = b.sectionId;
      return (
        <h3
          key={b.key}
          id={b.sectionId}
          data-section-id={b.sectionId}
          className="scroll-mt-24 pt-3 font-sans text-xs font-semibold uppercase tracking-[0.14em] text-accent"
        >
          {highlight(b.body, regex, b.key)}
        </h3>
      );
    }
    if (b.kind === "numbered") {
      return (
        <p key={b.key} className="flex gap-3" data-section-id={currentSection}>
          <span className="w-7 shrink-0 select-none text-right font-sans text-sm font-medium tabular-nums text-muted-2">
            {b.num}
          </span>
          <span className="flex-1">{highlight(b.body, regex, b.key)}</span>
        </p>
      );
    }
    return (
      <p key={b.key} className="pl-10" data-section-id={currentSection}>
        {highlight(b.body, regex, b.key)}
      </p>
    );
  });
}
