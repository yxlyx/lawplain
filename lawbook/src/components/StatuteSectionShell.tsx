"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { BackToTop } from "@/components/BackToTop";
import { FindToolbar } from "@/components/FindToolbar";
import { SectionNav, type SectionNavItem } from "@/components/SectionNav";
import { useSavedQuoteTarget } from "@/hooks/useSavedQuoteTarget";
import { useSectionEngagement } from "@/hooks/useSectionEngagement";
import { useTextFind } from "@/hooks/useTextFind";
import { parseTerms } from "@/lib/sections";

interface Suggestion {
  count: number;
  badge?: string;
}

export function StatuteSectionShell({
  docId,
  query,
  savedQuoteId,
  sections,
  children,
}: {
  docId: string;
  query: string;
  savedQuoteId?: string;
  sections: { id: string; label: string }[];
  children: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terms = useMemo(() => parseTerms(query), [query]);
  const [suggestions, setSuggestions] = useState<Map<string, Suggestion>>(
    () => new Map(),
  );

  const { matchCount, activeIndex, goPrev, goNext } = useTextFind(
    containerRef,
    query,
  );

  useSavedQuoteTarget(containerRef, "statute", savedQuoteId);

  useSectionEngagement({
    containerRef,
    docType: "statute",
    docId,
    terms,
  });

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
            const params = new URLSearchParams({
              docType: "statute",
              docId,
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
            // Suggestions are best-effort only.
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
  }, [docId, query, terms]);

  const navItems = useMemo<SectionNavItem[]>(() => {
    return sections.map((section) => {
      const suggestion = suggestions.get(section.id);
      return suggestion
        ? {
            id: section.id,
            label: section.label,
            count: suggestion.count,
            badge: suggestion.badge,
          }
        : section;
    });
  }, [sections, suggestions]);

  const showSectionNav = navItems.length >= 2;

  return (
    <div
      className={
        showSectionNav
          ? "grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,68ch)_16rem] lg:items-start"
          : "grid grid-cols-1 gap-6"
      }
    >
      <div className="min-w-0">
        {terms.length > 0 && (
          <FindToolbar
            query={query}
            subject="statute"
            matchCount={matchCount}
            activeIndex={activeIndex}
            searching={false}
            onPrev={goPrev}
            onNext={goNext}
          />
        )}
        <div ref={containerRef} data-selectable>
          {children}
        </div>
      </div>
      {showSectionNav && <SectionNav items={navItems} />}
      <BackToTop />
    </div>
  );
}
