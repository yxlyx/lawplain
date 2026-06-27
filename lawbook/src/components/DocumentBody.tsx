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
import { buildRegex, parseTerms } from "@/lib/sections";
import { ApiError, type DocumentKind, sgjudge } from "@/lib/sgjudge";

const PAGE = 60000;

/**
 * Full-document reader for hansard / bills / subsidiary legislation / practice
 * directions. Mirrors the Judgment reading experience (lazy body loading,
 * query highlighting, match count, prev/next match navigation, active-match
 * scrolling) without judgment-only features (section rail, suggestions).
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
              "Searching the document…"
            ) : (
              <>No matches for &ldquo;{query}&rdquo; in this document.</>
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
        {paragraphs.map((p, i) => (
          <p key={`p-${i}-${p.slice(0, 24)}`} className="scroll-mt-24">
            {highlight(p, regex, `p-${i}`)}
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
