"use client";

import { type RefObject, useEffect, useRef } from "react";
import { useAnalyticsConsent } from "@/hooks/useAnalyticsConsent";
import type { SuggestionDocType } from "@/lib/suggestions";

const DWELL_MS = 3000;

type SectionEngagementOptions<T extends HTMLElement> = {
  containerRef: RefObject<T | null>;
  docType: SuggestionDocType;
  docId: string;
  terms: string[];
  activeIndex?: number;
};

function sendEvent({
  docType,
  docId,
  term,
  sectionId,
}: {
  docType: SuggestionDocType;
  docId: string;
  term: string;
  sectionId: string;
}) {
  const body = JSON.stringify({
    kind: "section_engage",
    docType,
    docId,
    term,
    sectionId,
  });

  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon("/api/events", blob)) return;
  }

  void fetch("/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

function sectionForElement(el: Element | null): string | null {
  const own = el?.closest<HTMLElement>("[data-section-id]")?.dataset.sectionId;
  if (own) return own;
  let cur = el?.previousElementSibling;
  while (cur) {
    const id = (cur as HTMLElement).dataset.sectionId;
    if (id) return id;
    cur = cur.previousElementSibling;
  }
  return null;
}

export function useSectionEngagement<T extends HTMLElement>({
  containerRef,
  docType,
  docId,
  terms,
  activeIndex,
}: SectionEngagementOptions<T>) {
  const { canSend } = useAnalyticsConsent();
  const sent = useRef(new Set<string>());
  const timers = useRef(new Map<string, number>());

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !canSend || terms.length === 0) return;

    const flush = (sectionId: string) => {
      for (const term of terms) {
        const key = `${term}\u0000${sectionId}`;
        if (sent.current.has(key)) continue;
        sent.current.add(key);
        sendEvent({ docType, docId, term, sectionId });
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const sectionId = (entry.target as HTMLElement).dataset.sectionId;
          if (!sectionId) continue;
          if (entry.isIntersecting && entry.intersectionRatio >= 0.35) {
            if (!timers.current.has(sectionId)) {
              const timer = window.setTimeout(() => {
                timers.current.delete(sectionId);
                flush(sectionId);
              }, DWELL_MS);
              timers.current.set(sectionId, timer);
            }
          } else {
            const timer = timers.current.get(sectionId);
            if (timer) window.clearTimeout(timer);
            timers.current.delete(sectionId);
          }
        }
      },
      { threshold: [0.35] },
    );

    container
      .querySelectorAll<HTMLElement>("[data-section-id]")
      .forEach((el) => {
        observer.observe(el);
      });

    return () => {
      observer.disconnect();
      for (const timer of timers.current.values()) window.clearTimeout(timer);
      timers.current.clear();
    };
  }, [containerRef, canSend, docType, docId, terms]);

  useEffect(() => {
    if (!canSend || terms.length === 0 || activeIndex === undefined) return;
    const container = containerRef.current;
    if (!container) return;
    const marks = container.querySelectorAll<HTMLElement>("mark[data-match]");
    const sectionId = sectionForElement(marks[activeIndex]);
    if (!sectionId) return;
    for (const term of terms) {
      const key = `${term}\u0000${sectionId}`;
      if (sent.current.has(key)) continue;
      sent.current.add(key);
      sendEvent({ docType, docId, term, sectionId });
    }
  }, [containerRef, canSend, docType, docId, terms, activeIndex]);
}
