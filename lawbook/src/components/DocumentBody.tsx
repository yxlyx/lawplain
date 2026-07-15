"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackToTop } from "@/components/BackToTop";
import { FindToolbar } from "@/components/FindToolbar";
import { highlightText } from "@/lib/highlight";
import { buildRegex, parseTerms } from "@/lib/sections";
import { ApiError, type DocumentKind, sgjudge } from "@/lib/sgjudge";

const PAGE = 60000;

/**
 * Full-document reader for hansard / bills / subsidiary legislation / practice
 * directions / agency guidance. Mirrors the Judgment reading experience (lazy body loading,
 * query highlighting, match count, prev/next match navigation, active-match
 * scrolling) using the shared FindToolbar + highlight primitives (issue #70).
 */
export function DocumentBody({
  kind,
  docId,
  initialText,
  initialLoaded,
  total,
  query,
}: {
  kind: DocumentKind;
  docId: string;
  initialText: string;
  initialLoaded: number;
  total: number;
  query: string;
}) {
  const [text, setText] = useState(initialText);
  const [loaded, setLoaded] = useState(initialLoaded);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLElement>(null);
  const loadingRef = useRef(false);
  const autoLoads = useRef(0);
  const [active, setActive] = useState(0);

  const hasMore = loaded < total;
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 100;
  const terms = useMemo(() => parseTerms(query), [query]);
  const regex = useMemo(() => buildRegex(terms), [terms]);
  const paragraphs = useMemo(
    () =>
      text
        .split(/\n[^\S\n]*\n+/)
        .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
        .filter(Boolean),
    [text],
  );

  const matchCount = useMemo(() => {
    if (!regex) return 0;
    let count = 0;
    for (const p of paragraphs) count += p.match(regex)?.length ?? 0;
    return count;
  }, [paragraphs, regex]);
  const activeIndex = matchCount === 0 ? 0 : Math.min(active, matchCount - 1);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || loaded >= total) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await sgjudge.getDocument(kind, docId, {
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
      loadingRef.current = false;
      setLoading(false);
    }
  }, [kind, docId, loaded, total]);

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
    if (matchCount === 0) return;
    const el = containerRef.current;
    if (!el) return;
    const marks = el.querySelectorAll<HTMLElement>("mark[data-match]");
    marks.forEach((m, i) => {
      if (i === activeIndex) m.setAttribute("data-active", "");
      else m.removeAttribute("data-active");
    });
    marks[activeIndex]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeIndex, matchCount]);

  const goMatch = (dir: number) => {
    if (matchCount === 0) return;
    setActive((a) => {
      const cur = Math.min(a, matchCount - 1);
      return (cur + dir + matchCount) % matchCount;
    });
  };

  const searching =
    terms.length > 0 && matchCount === 0 && (loading || hasMore);

  return (
    <div>
      {terms.length > 0 && (
        <FindToolbar
          query={query}
          subject="document"
          matchCount={matchCount}
          activeIndex={activeIndex}
          searching={searching}
          onPrev={() => goMatch(-1)}
          onNext={() => goMatch(1)}
        />
      )}

      <article
        ref={containerRef}
        data-selectable
        className="flex max-w-[68ch] flex-col gap-4 font-serif text-[17px] leading-7 text-foreground/90"
      >
        {paragraphs.map((p, i) => (
          <p key={`p-${i}-${p.slice(0, 24)}`} className="scroll-mt-24">
            {highlightText(p, regex, `p-${i}`)}
          </p>
        ))}
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
          End of document · {total.toLocaleString()} characters
        </p>
      )}

      <BackToTop />
    </div>
  );
}
