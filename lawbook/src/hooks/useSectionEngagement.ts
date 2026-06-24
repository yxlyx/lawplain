"use client";

import { type RefObject, useCallback, useEffect, useRef } from "react";
import {
  type ClientDocType,
  canLog,
  logEngagement,
} from "@/lib/engagement-client";

/** Time a section must stay visible before it counts as an engagement. */
const DWELL_MS = 3000;
/** Hard cap on events emitted per page view, regardless of dedupe. */
const PER_VIEW_CAP = 50;
const PAIR_SEP = "\u0000";

interface UseSectionEngagementArgs {
  /** The rendered judgment/statute article. Sections carry `data-section-id`. */
  containerRef: RefObject<HTMLElement | null>;
  docType: ClientDocType;
  docId: string;
  /** Normalised search terms (from `parseTerms`). One event per (term, section). */
  terms: string[];
  /**
   * A value that changes whenever the rendered content grows (e.g. the loaded
   * char count), so the observer re-attaches to newly paginated sections.
   */
  contentKey: unknown;
}

/**
 * Logs anonymous section-engagement beacons for the current page view.
 *
 * Two engagement signals, coalesced to at most one event per (term, sectionId):
 *  1. Dwell — a section stays >{@link DWELL_MS} in view (IntersectionObserver).
 *  2. Active-match landing — call {@link logActiveMatch} when the match
 *     navigator steps onto a `<mark data-active>` inside a section.
 *
 * All emission is gated by `canLog()` (consent granted AND Do-Not-Track off);
 * nothing is sent before consent. Fire-and-forget via `navigator.sendBeacon`.
 */
export function useSectionEngagement({
  containerRef,
  docType,
  docId,
  terms,
  contentKey,
}: UseSectionEngagementArgs) {
  // (term, sectionId) pairs already logged this page view.
  const sent = useRef<Set<string>>(new Set());
  const emitted = useRef(0);
  // Keep latest terms/ids available to stable callbacks without re-subscribing.
  const termsRef = useRef(terms);
  termsRef.current = terms;

  const emit = useCallback(
    (sectionId: string) => {
      if (!sectionId) return;
      if (!canLog()) return;
      for (const term of termsRef.current) {
        if (emitted.current >= PER_VIEW_CAP) return;
        const pair = `${term}${PAIR_SEP}${sectionId}`;
        if (sent.current.has(pair)) continue;
        sent.current.add(pair);
        emitted.current += 1;
        logEngagement({
          kind: "section_engage",
          docType,
          docId,
          term,
          sectionId,
        });
      }
    },
    [docType, docId],
  );

  // Map the currently active match's enclosing section to an engagement.
  const logActiveMatch = useCallback(() => {
    const root = containerRef.current;
    if (!root) return;
    const active = root.querySelector<HTMLElement>(
      "mark[data-match][data-active]",
    );
    const sectionId = active
      ?.closest<HTMLElement>("[data-section-id]")
      ?.getAttribute("data-section-id");
    if (sectionId) emit(sectionId);
  }, [containerRef, emit]);

  // Dwell observer. Re-attaches when content grows or terms appear/disappear.
  useEffect(() => {
    void contentKey;
    const root = containerRef.current;
    if (!root) return;
    if (terms.length === 0) return;
    // Quick gate: if logging can't happen at all, skip the observer entirely.
    if (!canLog()) return;

    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.getAttribute("data-section-id") ?? "";
          if (!id) continue;
          if (entry.isIntersecting) {
            if (timers.has(id)) continue;
            timers.set(
              id,
              setTimeout(() => {
                timers.delete(id);
                emit(id);
              }, DWELL_MS),
            );
          } else {
            const t = timers.get(id);
            if (t) {
              clearTimeout(t);
              timers.delete(id);
            }
          }
        }
      },
      { threshold: 0.5 },
    );

    // Observe one representative element per unique section id.
    const seen = new Set<string>();
    root.querySelectorAll<HTMLElement>("[data-section-id]").forEach((el) => {
      const id = el.getAttribute("data-section-id");
      if (!id || seen.has(id)) return;
      seen.add(id);
      observer.observe(el);
    });

    return () => {
      observer.disconnect();
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
    // `contentKey` changes when more text loads; `terms` join when the query changes.
  }, [containerRef, emit, terms, contentKey]);

  return { logActiveMatch };
}
