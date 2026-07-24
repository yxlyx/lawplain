"use client";

import { type RefObject, useEffect, useRef } from "react";
import { authClient } from "@/lib/auth-client";
import { findPassageRange } from "@/lib/passage-anchor";
import type { SavedQuote } from "@/lib/saved-quotes";

const HIGHLIGHT_NAME = "saved-quote-target";
const HIGHLIGHT_DURATION_MS = 5_000;
const HIGHLIGHT_COLOR = "rgba(125, 164, 221, 0.22)";
const HIGHLIGHT_STYLES = `::highlight(${HIGHLIGHT_NAME}) {
  background: ${HIGHLIGHT_COLOR};
  color: inherit;
}`;

type HighlightRegistry = {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
};

type HighlightConstructor = new (...ranges: Range[]) => unknown;

/**
 * Resolves a saved quote within its original anchored block, scrolls the exact
 * range into view, and highlights it temporarily. The saved quote is fetched
 * by id so long passages do not have to be embedded in the destination URL.
 */
export function useSavedQuoteTarget(
  containerRef: RefObject<HTMLElement | null>,
  docType: SavedQuote["docType"],
  quoteId: string | undefined,
  onTargetMissing?: () => boolean,
) {
  const { data: session } = authClient.useSession();
  const ownerId = session?.user.id;
  const onTargetMissingRef = useRef(onTargetMissing);
  onTargetMissingRef.current = onTargetMissing;

  useEffect(() => {
    if (!quoteId || !ownerId) return;
    const savedQuoteId = quoteId;
    const controller = new AbortController();

    let cancelled = false;
    let observer: MutationObserver | null = null;
    let highlightTimer: number | null = null;
    let removeHighlight: (() => void) | null = null;
    let restoreFocusTarget: (() => void) | null = null;

    function tryFallback() {
      if (cancelled) return true;
      const fallbackId = currentHashId();
      const target = fallbackId ? document.getElementById(fallbackId) : null;
      if (target) {
        observer?.disconnect();
        scrollElementIntoView(target);
        return true;
      }
      const shouldRetry = onTargetMissingRef.current?.() ?? false;
      if (!shouldRetry) observer?.disconnect();
      return !shouldRetry;
    }

    function observeUntilResolved(attempt: () => boolean) {
      if (attempt()) return;
      const root = containerRef.current;
      if (!root) return;
      observer = new MutationObserver(attempt);
      observer.observe(root, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }

    async function revealQuote() {
      try {
        const res = await fetch(
          `/api/quotes/${encodeURIComponent(savedQuoteId)}`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );
        if (!res.ok) {
          observeUntilResolved(tryFallback);
          return;
        }
        const data = (await res.json()) as { quote?: SavedQuote };
        const quote = data.quote;
        if (
          cancelled ||
          !quote ||
          quote.docType !== docType ||
          !isCurrentDocument(quote.path)
        ) {
          observeUntilResolved(tryFallback);
          return;
        }

        const tryReveal = () => {
          if (cancelled) return true;
          const root = containerRef.current;
          if (!root) return false;
          const range = findPassageRange(root, quote, [currentHashId()]);
          if (!range) {
            const shouldRetry = onTargetMissingRef.current?.() ?? false;
            return shouldRetry ? false : tryFallback();
          }

          observer?.disconnect();
          removeHighlight = applyTemporaryHighlight(range);
          restoreFocusTarget = focusRangeStart(range);
          scrollRangeIntoView(range);
          highlightTimer = window.setTimeout(() => {
            removeHighlight?.();
            removeHighlight = null;
            restoreFocusTarget?.();
            restoreFocusTarget = null;
          }, HIGHLIGHT_DURATION_MS);
          return true;
        };

        observeUntilResolved(tryReveal);
      } catch {
        observeUntilResolved(tryFallback);
      }
    }

    void revealQuote();

    return () => {
      cancelled = true;
      controller.abort();
      observer?.disconnect();
      if (highlightTimer !== null) window.clearTimeout(highlightTimer);
      removeHighlight?.();
      restoreFocusTarget?.();
    };
  }, [containerRef, docType, ownerId, quoteId]);
}

function currentHashId() {
  try {
    return decodeURIComponent(window.location.hash.slice(1));
  } catch {
    return window.location.hash.slice(1);
  }
}

function isCurrentDocument(path: string) {
  try {
    return (
      new URL(path, window.location.origin).pathname ===
      window.location.pathname
    );
  } catch {
    return false;
  }
}

function applyTemporaryHighlight(range: Range) {
  const registry = (CSS as unknown as { highlights?: HighlightRegistry })
    .highlights;
  const HighlightClass = (
    window as unknown as { Highlight?: HighlightConstructor }
  ).Highlight;

  if (registry && HighlightClass) {
    const style = document.createElement("style");
    style.textContent = HIGHLIGHT_STYLES;
    document.head.appendChild(style);
    registry.set(HIGHLIGHT_NAME, new HighlightClass(range));
    return () => {
      registry.delete(HIGHLIGHT_NAME);
      style.remove();
    };
  }

  // Avoid commandeering the user's text selection in older browsers. A fixed
  // overlay follows each range rect while the page smoothly scrolls.
  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  Object.assign(layer.style, {
    position: "fixed",
    inset: "0",
    pointerEvents: "none",
    zIndex: "20",
  });

  const draw = () => {
    layer.replaceChildren(
      ...Array.from(range.getClientRects(), (rect) => {
        const highlight = document.createElement("span");
        Object.assign(highlight.style, {
          position: "absolute",
          top: `${rect.top}px`,
          left: `${rect.left}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          borderRadius: "2px",
          background: HIGHLIGHT_COLOR,
        });
        return highlight;
      }),
    );
  };

  document.body.appendChild(layer);
  draw();
  window.addEventListener("scroll", draw, { passive: true });
  window.addEventListener("resize", draw);
  return () => {
    window.removeEventListener("scroll", draw);
    window.removeEventListener("resize", draw);
    layer.remove();
  };
}

function focusRangeStart(range: Range) {
  const startElement =
    range.startContainer.nodeType === Node.ELEMENT_NODE
      ? (range.startContainer as HTMLElement)
      : range.startContainer.parentElement;
  const target =
    startElement?.closest<HTMLElement>("[data-section-id]") ?? startElement;
  if (!target) return () => {};

  const previousTabIndex = target.getAttribute("tabindex");
  target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
  return () => {
    if (previousTabIndex === null) target.removeAttribute("tabindex");
    else target.setAttribute("tabindex", previousTabIndex);
  };
}

function scrollElementIntoView(element: HTMLElement) {
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  element.scrollIntoView({
    block: "start",
    behavior: reduceMotion ? "auto" : "smooth",
  });
}

function scrollRangeIntoView(range: Range) {
  const rect = range.getBoundingClientRect();
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  window.scrollBy({
    top: rect.top + rect.height / 2 - window.innerHeight / 2,
    behavior: reduceMotion ? "auto" : "smooth",
  });
}
