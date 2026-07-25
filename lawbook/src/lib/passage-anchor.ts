/**
 * Shared passage anchoring (#189).
 *
 * One anchor format serves both saved-quote deep links and restored in-document
 * annotations: a block anchor, the exact captured text, its offsets within that
 * block, and the surrounding context. Resolution is deliberately conservative —
 * a passage matches only when its exact text is still present, and context
 * scoring merely disambiguates repeated occurrences. When the exact text is
 * absent the caller gets `null` and must report a stale anchor rather than
 * attach the annotation to a merely similar passage.
 */
export interface PassageLocator {
  anchor: string;
  exactText: string;
  startOffset: number;
  endOffset: number;
  contextBefore: string;
  contextAfter: string;
}

interface PassageMatch {
  element: HTMLElement;
  offset: number;
  context: number;
  storedOffset: boolean;
}

/**
 * Resolves a locator to a live Range inside `root`, or null when the captured
 * text is no longer present. `fallbackSectionIds` lets an older locator whose
 * block anchor has changed still resolve within a known section.
 */
export function findPassageRange(
  root: HTMLElement,
  locator: PassageLocator,
  fallbackSectionIds: Iterable<string> = [],
): Range | null {
  const elements = Array.from(
    root.querySelectorAll<HTMLElement>("[data-section-id]"),
  );
  const anchored = elements.filter(
    (element) => element.dataset.quoteAnchor === locator.anchor,
  );
  const anchoredMatch = bestPassageMatch(anchored, locator);
  if (anchoredMatch) return rangeForMatch(anchoredMatch, locator);

  // Older passages used the section id as their anchor. The section also lets a
  // passage survive a changed block anchor while retaining exact/context
  // matching within that section.
  const sectionIds = new Set([locator.anchor, ...fallbackSectionIds]);
  const sectionMatch = bestPassageMatch(
    elements.filter((element) =>
      sectionIds.has(element.dataset.sectionId ?? ""),
    ),
    locator,
  );
  return sectionMatch ? rangeForMatch(sectionMatch, locator) : null;
}

function bestPassageMatch(
  elements: HTMLElement[],
  locator: PassageLocator,
): PassageMatch | null {
  let best: PassageMatch | null = null;
  for (const element of elements) {
    const text = element.textContent ?? "";
    let offset = text.indexOf(locator.exactText);
    while (offset !== -1) {
      const match: PassageMatch = {
        element,
        offset,
        context: contextScore(text, offset, locator),
        storedOffset:
          offset === locator.startOffset &&
          offset + locator.exactText.length === locator.endOffset,
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
      offset = text.indexOf(locator.exactText, offset + 1);
    }
  }
  return best;
}

function rangeForMatch(match: PassageMatch, locator: PassageLocator) {
  return rangeForOffsets(
    match.element,
    match.offset,
    match.offset + locator.exactText.length,
  );
}

function contextScore(
  text: string,
  offset: number,
  locator: PassageLocator,
): number {
  const before = text.slice(
    Math.max(0, offset - locator.contextBefore.length),
    offset,
  );
  const after = text.slice(
    offset + locator.exactText.length,
    offset + locator.exactText.length + locator.contextAfter.length,
  );
  return (
    matchingSuffixLength(before, locator.contextBefore) +
    matchingPrefixLength(after, locator.contextAfter)
  );
}

function matchingPrefixLength(a: string, b: string): number {
  let length = 0;
  while (length < a.length && length < b.length && a[length] === b[length]) {
    length += 1;
  }
  return length;
}

function matchingSuffixLength(a: string, b: string): number {
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

/** Maps character offsets within an element's text to a DOM Range. */
export function rangeForOffsets(
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

/**
 * True when the CSS Custom Highlight API can paint ranges without rewriting the
 * document. Highlighting is skipped entirely when it is unavailable — an
 * annotation is listed and deep-linkable, but never re-rendered into the text.
 */
export function supportsHighlightApi(): boolean {
  return (
    typeof CSS !== "undefined" &&
    Boolean((CSS as unknown as { highlights?: unknown }).highlights) &&
    typeof (window as unknown as { Highlight?: unknown }).Highlight ===
      "function"
  );
}
