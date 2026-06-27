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
  type DocSection,
  parseBlocks,
  parseTerms,
  slugify,
} from "@/lib/sections";
import { ApiError, type JudgmentSection, sgjudge } from "@/lib/sgjudge";

const PAGE = 60000;

interface RenderSection extends DocSection {
  startOffset: number;
  endOffset?: number;
}

function normalizeBackendSections(
  sections?: JudgmentSection[],
): RenderSection[] {
  const seen = new Map<string, number>();
  const normalized: RenderSection[] = [];

  for (const [index, section] of (sections ?? []).entries()) {
    const label = section.label.replace(/\s+/g, " ").trim();
    if (!label || typeof section.start_offset !== "number") continue;

    const rawId =
      typeof section.id === "string" && section.id.trim()
        ? section.id.trim()
        : slugify(label) || `section-${index + 1}`;
    const occ = seen.get(rawId) ?? 0;
    seen.set(rawId, occ + 1);

    normalized.push({
      id: occ === 0 ? rawId : `${rawId}-${occ + 1}`,
      label,
      startOffset: section.start_offset,
      endOffset: section.end_offset,
    });
  }

  return normalized.sort((a, b) => a.startOffset - b.startOffset);
}

interface Suggestion {
  count: number;
  badge?: string;
}

/**
 * Renders judgment body text with a "load more" control and a section rail.
 * Suggested/popular sections are annotated only; section order stays as the
 * judgment wrote it.
 */
export function JudgmentBody({
  citation,
  initialText,
  initialLoaded,
  total,
  query,
  initialSections,
  mockSuggestions,
}: {
  citation: string;
  source?: unknown;
  pagePath?: string;
  title?: string;
  initialText: string;
  initialLoaded: number;
  total: number;
  query: string;
  initialSections?: JudgmentSection[];
  mockSuggestions?: Record<string, Suggestion>;
}) {
  const [text, setText] = useState(initialText);
  const [loaded, setLoaded] = useState(initialLoaded);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Map<string, Suggestion>>(
    () => new Map(Object.entries(mockSuggestions ?? {})),
  );

  const containerRef = useRef<HTMLElement>(null);
  const loadingRef = useRef(false);
  const autoLoads = useRef(0);
  const hashAutoLoads = useRef(0);
  const initialHash = useRef<string | null>(null);
  const hashScrolled = useRef(false);
  const [active, setActive] = useState(0);
  const [activeTouched, setActiveTouched] = useState(false);

  if (initialHash.current === null && typeof window !== "undefined") {
    initialHash.current = window.location.hash.slice(1);
  }

  const hasMore = loaded < total;
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 100;
  const terms = useMemo(() => parseTerms(query), [query]);
  const regex = useMemo(() => buildRegex(terms), [terms]);
  const blocks = useMemo(() => parseBlocks(text), [text]);
  const sections = useMemo(
    () => normalizeBackendSections(initialSections),
    [initialSections],
  );
  const loadedSections = useMemo(
    () => sections.filter((section) => section.startOffset < text.length),
    [sections, text.length],
  );

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
    if (loadingRef.current || loaded >= total) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const offset = loaded;
      const res = await sgjudge.getJudgment(citation, {
        include_body: true,
        body_offset: offset,
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
      loadingRef.current = false;
      setLoading(false);
    }
  }, [citation, loaded, total]);

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

  useEffect(() => {
    const target = window.location.hash.slice(1);
    if (!target || document.getElementById(target)) return;
    if (hasMore && !loading && hashAutoLoads.current < 40) {
      hashAutoLoads.current += 1;
      loadMore();
    }
  }, [hasMore, loading, loadMore]);

  // Deep links (#section) must scroll into place after hydration and after any
  // paginated body text has loaded. The browser's native hash scroll fires
  // before client content settles, so re-apply it once the target exists.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run as `text` grows so the target can resolve after pagination.
  useEffect(() => {
    if (hashScrolled.current) return;
    const id = initialHash.current;
    if (!id) {
      hashScrolled.current = true;
      return;
    }
    if (!document.getElementById(id)) return;
    hashScrolled.current = true;
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ block: "start" });
    });
  }, [text]);

  useEffect(() => {
    if (mockSuggestions) {
      setSuggestions(new Map(Object.entries(mockSuggestions)));
      return;
    }

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
            const params = new URLSearchParams({
              docType: "judgment",
              docId: citation,
              term,
            });
            const res = await fetch(`/api/suggestions?${params}`, {
              cache: "no-store",
            });
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
  }, [terms, citation, query, mockSuggestions]);

  useEffect(() => {
    if (matchCount === 0) return;
    const el = containerRef.current;
    if (!el) return;
    const marks = el.querySelectorAll<HTMLElement>("mark[data-match]");
    marks.forEach((m, i) => {
      if (i === activeIndex) m.setAttribute("data-active", "");
      else m.removeAttribute("data-active");
    });
    // When the URL deep-links to a section (#hash), let that section win the
    // initial scroll instead of yanking the viewport to the first match. Once
    // the user navigates matches (activeTouched), match scrolling resumes.
    if (!activeTouched && initialHash.current) return;
    marks[activeIndex]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeIndex, matchCount, activeTouched]);

  const goMatch = (dir: number) => {
    if (matchCount === 0) return;
    setActiveTouched(true);
    setActive((a) => {
      const cur = Math.min(a, matchCount - 1);
      return (cur + dir + matchCount) % matchCount;
    });
  };

  const navItems = useMemo<SectionNavItem[]>(() => {
    return loadedSections.map((section) => {
      const suggestion = suggestions.get(section.id);
      return suggestion
        ? {
            id: section.id,
            label: section.label,
            count: suggestion.count,
            badge: suggestion.badge,
          }
        : { id: section.id, label: section.label };
    });
  }, [loadedSections, suggestions]);

  const searching =
    terms.length > 0 && matchCount === 0 && (loading || hasMore);
  const showSectionNav = navItems.length >= 2;

  useSectionEngagement({
    containerRef,
    docType: "judgment",
    docId: citation,
    terms,
    activeIndex: activeTouched ? activeIndex : undefined,
  });

  return (
    <div
      className={
        showSectionNav
          ? "grid gap-6 lg:grid-cols-[minmax(0,68ch)_16rem] lg:items-start"
          : "grid gap-6"
      }
    >
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

        <article
          ref={containerRef}
          className="flex max-w-[68ch] flex-col gap-4 font-serif text-[17px] leading-7 text-foreground/90"
        >
          {renderJudgment(blocks, regex, loadedSections)}
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

      {showSectionNav && <SectionNav items={navItems} />}
    </div>
  );
}

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

function renderJudgment(
  blocks: Block[],
  regex: RegExp | null,
  sections: RenderSection[],
) {
  const rendered: ReactNode[] = [];
  let sectionIndex = 0;
  let currentSectionId: string | undefined;

  for (const block of blocks) {
    const anchors: ReactNode[] = [];
    const blockEnd = block.endOffset ?? Number.MAX_SAFE_INTEGER;
    let blockIsSectionHeading = false;

    while (
      sectionIndex < sections.length &&
      sections[sectionIndex].startOffset <= blockEnd
    ) {
      const section = sections[sectionIndex];
      currentSectionId = section.id;
      // The backend knows this is a heading even when the local heuristic does
      // not (multi-word, mixed-case titles). Style the matching block as a
      // heading so it does not read as an indented body paragraph (issue #69).
      if (sectionLabelMatchesBlock(section.label, block.body)) {
        blockIsSectionHeading = true;
      }
      anchors.push(
        <span
          key={`anchor-${section.id}`}
          id={section.id}
          data-section-id={section.id}
          data-section-label={section.label}
          aria-hidden="true"
          className="absolute -top-24 left-0 h-px w-px scroll-mt-24"
        />,
      );
      sectionIndex += 1;
    }

    rendered.push(
      <div key={block.key} className="relative">
        {anchors}
        {renderBlock(block, regex, currentSectionId, blockIsSectionHeading)}
      </div>,
    );
  }

  return rendered;
}

function renderBlock(
  b: Block,
  regex: RegExp | null,
  currentSectionId?: string,
  forceHeading = false,
): ReactNode {
  if (b.kind === "heading" || forceHeading) {
    return (
      <h3
        data-section-id={currentSectionId}
        className="pt-3 font-sans text-xs font-semibold uppercase tracking-[0.14em] text-accent"
      >
        {highlight(b.body, regex, b.key)}
      </h3>
    );
  }
  if (b.kind === "numbered") {
    return (
      <p
        id={b.id}
        data-section-id={currentSectionId}
        className="flex scroll-mt-24 gap-3"
      >
        <span className="w-7 shrink-0 select-none text-right font-sans text-sm font-medium tabular-nums text-muted-2">
          {b.num}
        </span>
        <span className="flex-1">{highlight(b.body, regex, b.key)}</span>
      </p>
    );
  }
  return (
    <p
      id={b.id}
      data-section-id={currentSectionId}
      className="scroll-mt-24 pl-10"
    >
      {highlight(b.body, regex, b.key)}
    </p>
  );
}

function sectionLabelMatchesBlock(label: string, body: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  return norm(label) === norm(body);
}
