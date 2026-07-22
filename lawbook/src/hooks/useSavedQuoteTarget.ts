"use client";

import { type RefObject, useEffect, useRef } from "react";
import type { SavedQuote } from "@/lib/saved-quotes";

const HIGHLIGHT_NAME = "saved-quote-target";
const HIGHLIGHT_DURATION_MS = 5_000;
const HIGHLIGHT_STYLES = `::highlight(${HIGHLIGHT_NAME}) {
  background: rgba(125, 164, 221, 0.22);
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
  onTargetMissing?: () => boolean,
) {
  const onTargetMissingRef = useRef(onTargetMissing);
  onTargetMissingRef.current = onTargetMissing;

  useEffect(() => {
    const quoteId = new URL(window.location.href).searchParams.get(
      "savedQuote",
    );
    if (!quoteId) return;
    const savedQuoteId = quoteId;

    let cancelled = false;
    let observer: MutationObserver | null = null;
    let highlightTimer: number | null = null;
    let removeHighlight: (() => void) | null = null;
    let restoreFocusTarget: (() => void) | null = null;

    async function revealQuote() {
      try {
        const res = await fetch(
          `/api/quotes/${encodeURIComponent(savedQuoteId)}`,
          {
            cache: "no-store",
          },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { quote?: SavedQuote };
        const quote = data.quote;
        if (
          cancelled ||
          !quote ||
          quote.docType !== docType ||
          !isCurrentDocument(quote.path)
        ) {
          return;
        }

        const tryReveal = () => {
          if (cancelled) return true;
          const root = containerRef.current;
          if (!root) return false;
          const range = findQuoteRange(root, quote);
          if (!range) {
            const shouldRetry = onTargetMissingRef.current?.() ?? false;
            if (!shouldRetry) observer?.disconnect();
            return !shouldRetry;
          }

          observer?.disconnect();
          removeHighlight = applyTemporaryHighlight(range);
          restoreFocusTarget = focusRangeStart(range);
          scrollRangeIntoView(range);
          highlightTimer = window.setTimeout(() => {
            removeHighlight?.();
            removeHighlight = null;
          }, HIGHLIGHT_DURATION_MS);
          return true;
        };

        if (tryReveal()) return;

        const root = containerRef.current;
        if (!root) return;
        observer = new MutationObserver(tryReveal);
        observer.observe(root, { childList: true, subtree: true });
      } catch {
        // The section hash still provides a useful fallback if lookup fails.
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
  }, [containerRef, docType]);
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
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>("[data-section-id]"),
  ).filter((element) => element.dataset.sectionId === quote.anchor);

  let best: { element: HTMLElement; offset: number; score: number } | null =
    null;

  for (const element of candidates) {
    const text = element.textContent ?? "";
    let offset = text.indexOf(quote.exactText);
    while (offset !== -1) {
      const isStoredOffset =
        offset === quote.startOffset &&
        offset + quote.exactText.length === quote.endOffset;
      const score =
        contextScore(text, offset, quote) + (isStoredOffset ? 1_000 : 0);
      if (!best || score > best.score) best = { element, offset, score };
      offset = text.indexOf(quote.exactText, offset + 1);
    }
  }

  if (!best) return null;
  return rangeForOffsets(
    best.element,
    best.offset,
    best.offset + quote.exactText.length,
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

  // CSS Custom Highlight is unavailable only in older browsers. Selecting the
  // range still gives those users an exact, temporary visual location cue.
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return () => {
    const current = window.getSelection();
    if (
      current?.rangeCount &&
      current.getRangeAt(0).toString() === range.toString()
    ) {
      current.removeAllRanges();
    }
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
