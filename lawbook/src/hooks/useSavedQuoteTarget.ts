"use client";

import { type RefObject, useEffect, useRef } from "react";
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
  const onTargetMissingRef = useRef(onTargetMissing);
  onTargetMissingRef.current = onTargetMissing;

  useEffect(() => {
    if (!quoteId) return;
    const savedQuoteId = quoteId;

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
          const range = findQuoteRange(root, quote);
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
      observer?.disconnect();
      if (highlightTimer !== null) window.clearTimeout(highlightTimer);
      removeHighlight?.();
      restoreFocusTarget?.();
    };
  }, [containerRef, docType, quoteId]);
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

function findQuoteRange(root: HTMLElement, quote: SavedQuote): Range | null {
  const elements = Array.from(
    root.querySelectorAll<HTMLElement>("[data-section-id]"),
  );
  const anchored = elements.filter(
    (element) => element.dataset.quoteAnchor === quote.anchor,
  );
  const anchoredMatch = bestQuoteMatch(anchored, quote);
  if (anchoredMatch) return rangeForMatch(anchoredMatch, quote);

  // Older quotes used the section id as their anchor. The section hash also
  // lets a quote survive a changed block anchor while retaining exact/context
  // matching across that section.
  const sectionIds = new Set([quote.anchor, currentHashId()]);
  const sectionMatch = bestQuoteMatch(
    elements.filter((element) =>
      sectionIds.has(element.dataset.sectionId ?? ""),
    ),
    quote,
  );
  return sectionMatch ? rangeForMatch(sectionMatch, quote) : null;
}

type QuoteMatch = {
  element: HTMLElement;
  offset: number;
  context: number;
  storedOffset: boolean;
};

function bestQuoteMatch(elements: HTMLElement[], quote: SavedQuote) {
  let best: QuoteMatch | null = null;
  for (const element of elements) {
    const text = element.textContent ?? "";
    let offset = text.indexOf(quote.exactText);
    while (offset !== -1) {
      const match: QuoteMatch = {
        element,
        offset,
        context: contextScore(text, offset, quote),
        storedOffset:
          offset === quote.startOffset &&
          offset + quote.exactText.length === quote.endOffset,
      };
      if (
        !best ||
        match.context > best.context ||
        (match.context === best.context &&
          match.storedOffset &&
          !best.storedOffset)
      ) {
        best = match;
      }
      offset = text.indexOf(quote.exactText, offset + 1);
    }
  }
  return best;
}

function rangeForMatch(match: QuoteMatch, quote: SavedQuote) {
  return rangeForOffsets(
    match.element,
    match.offset,
    match.offset + quote.exactText.length,
  );
}

function contextScore(text: string, offset: number, quote: SavedQuote) {
  const before = text.slice(
    Math.max(0, offset - quote.contextBefore.length),
    offset,
  );
  const after = text.slice(
    offset + quote.exactText.length,
    offset + quote.exactText.length + quote.contextAfter.length,
  );
  return (
    matchingSuffixLength(before, quote.contextBefore) +
    matchingPrefixLength(after, quote.contextAfter)
  );
}

function matchingPrefixLength(a: string, b: string) {
  let length = 0;
  while (length < a.length && length < b.length && a[length] === b[length]) {
    length += 1;
  }
  return length;
}

function matchingSuffixLength(a: string, b: string) {
  let length = 0;
  while (
    length < a.length &&
    length < b.length &&
    a[a.length - 1 - length] === b[b.length - 1 - length]
  ) {
    length += 1;
  }
  return length;
}

function rangeForOffsets(
  element: HTMLElement,
  startOffset: number,
  endOffset: number,
): Range | null {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    nodes.push(node as Text);
    node = walker.nextNode();
  }

  let position = 0;
  let start: { node: Text; offset: number } | null = null;
  let end: { node: Text; offset: number } | null = null;

  for (const textNode of nodes) {
    const nextPosition = position + textNode.data.length;
    if (!start && startOffset <= nextPosition) {
      start = { node: textNode, offset: startOffset - position };
    }
    if (endOffset <= nextPosition) {
      end = { node: textNode, offset: endOffset - position };
      break;
    }
    position = nextPosition;
  }

  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
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
