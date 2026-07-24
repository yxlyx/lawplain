"use client";

import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { annotationLabelToken } from "@/lib/annotation-labels";
import { authClient } from "@/lib/auth-client";
import {
  findPassageRange,
  type PassageLocator,
  supportsHighlightApi,
} from "@/lib/passage-anchor";
import type { SavedDocType } from "@/lib/saved-workspace";

const PAGE_LIMIT = 100;
/** Bounds a broken cursor rather than the reader's real annotation count. */
const MAX_PAGES = 20;
/** Loading a body page emits a burst of records; one pass per burst suffices. */
const RESOLVE_DEBOUNCE_MS = 120;
const HIGHLIGHT_PREFIX = "lawplain-annotation-";
const ACTIVE_HIGHLIGHT = `${HIGHLIGHT_PREFIX}active`;
/** Dispatched by the selection toolbar so a new highlight paints immediately. */
export const ANNOTATIONS_CHANGED_EVENT = "lawplain:annotations-changed";

const NO_ANNOTATIONS: DocumentAnnotation[] = [];

export interface DocumentAnnotation extends PassageLocator {
  id: string;
  docType: SavedDocType;
  docId: string;
  title: string;
  citation: string;
  path: string;
  note: string | null;
  label: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * A missing range means two very different things, and conflating them would
 * either cry wolf on every long judgment or hide real data loss: "pending" is a
 * passage below the last paginated page, "orphaned" is a passage the fully
 * loaded document no longer contains.
 */
export type AnnotationStatus = "anchored" | "pending" | "orphaned";

export interface DocumentAnnotationsState {
  ownerId: string | null;
  annotations: DocumentAnnotation[];
  statuses: Record<string, AnnotationStatus>;
  ranges: Map<string, Range>;
  activeId: string | null;
  open: (id: string) => void;
  close: () => void;
  replace: (annotation: DocumentAnnotation) => void;
  remove: (id: string) => void;
  /** False where the browser cannot paint; annotations stay listed and openable. */
  highlightsPainted: boolean;
  error: string | null;
}

interface AnchoredPassage {
  id: string;
  range: Range;
}

interface AnnotationPage {
  annotations?: DocumentAnnotation[];
  nextCursor?: string | null;
}

type HighlightInstance = { priority: number };
type HighlightConstructor = new (...ranges: Range[]) => HighlightInstance;
type HighlightRegistry = {
  set(name: string, highlight: HighlightInstance): void;
  delete(name: string): void;
};

/**
 * Restores the signed-in reader's own annotations inside a rendered document
 * and paints them with the CSS Custom Highlight API.
 *
 * `isFullyLoaded` is the difference between an honest "not here yet" and an
 * honest "no longer here": judgment bodies arrive in pages, so an unresolved
 * passage is expected until the last page has landed.
 */
export function useDocumentAnnotations(
  containerRef: RefObject<HTMLElement | null>,
  docType: SavedDocType,
  docId: string,
  isFullyLoaded: boolean,
): DocumentAnnotationsState {
  const { data: session } = authClient.useSession();
  const ownerId = session?.user.id ?? null;
  const [dataOwnerId, setDataOwnerId] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<DocumentAnnotation[]>([]);
  const [anchored, setAnchored] = useState<AnchoredPassage[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [canPaint, setCanPaint] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const requestVersion = useRef(0);
  const rangesRef = useRef(new Map<string, Range>());

  const ownerStateIsCurrent = Boolean(ownerId) && dataOwnerId === ownerId;
  const visible = ownerStateIsCurrent ? annotations : NO_ANNOTATIONS;

  useEffect(() => {
    setCanPaint(supportsHighlightApi());
  }, []);

  // A passage highlighted from the selection toolbar must appear without a
  // reload; the toolbar cannot reach this state, so it announces instead.
  useEffect(() => {
    const refresh = () => setRefreshToken((token) => token + 1);
    window.addEventListener(ANNOTATIONS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(ANNOTATIONS_CHANGED_EVENT, refresh);
  }, []);

  // Switching account or document discards everything; a refresh keeps what is
  // already resolved so re-fetching cannot blank the page or drop a highlight.
  // biome-ignore lint/correctness/useExhaustiveDependencies: docType/docId are the identity being reset, not values the body reads.
  useEffect(() => {
    rangesRef.current.clear();
    setDataOwnerId(ownerId);
    setAnnotations([]);
    setAnchored([]);
    setActiveId(null);
    setError(null);
  }, [docId, docType, ownerId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshToken is the re-fetch trigger; the body reads nothing from it.
  useEffect(() => {
    const version = ++requestVersion.current;
    if (!ownerId) return;
    const controller = new AbortController();

    async function load() {
      const collected: DocumentAnnotation[] = [];
      let cursor: string | null = null;
      try {
        for (let page = 0; page < MAX_PAGES; page += 1) {
          const params = new URLSearchParams({
            docType,
            docId,
            limit: String(PAGE_LIMIT),
          });
          if (cursor) params.set("cursor", cursor);
          const response = await fetch(`/api/annotations?${params}`, {
            cache: "no-store",
            signal: controller.signal,
          });
          if (!response.ok) throw new Error("Could not load your annotations.");
          const data = (await response.json()) as AnnotationPage;
          if (controller.signal.aborted || version !== requestVersion.current)
            return;
          collected.push(...(data.annotations ?? []));
          cursor = data.nextCursor ?? null;
          if (!cursor) break;
        }
        setAnnotations(collected);
      } catch (caught) {
        if (controller.signal.aborted || version !== requestVersion.current)
          return;
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not load your annotations.",
        );
      }
    }

    void load();
    return () => {
      controller.abort();
      requestVersion.current += 1;
    };
  }, [docId, docType, ownerId, refreshToken]);

  const resolvePassages = useCallback(
    (items: DocumentAnnotation[]) => {
      const root = containerRef.current;
      if (!root) return;
      const ranges = rangesRef.current;
      const byId = new Map(items.map((item) => [item.id, item]));
      for (const [id, range] of ranges) {
        const item = byId.get(id);
        // Connectedness is not enough. React reuses a keyed text node when a
        // paginated block grows, rewriting its contents in place, and the Range
        // survives that edit still pointing at those offsets — now spelling
        // different words. Re-reading it is the only way to know the passage is
        // still the one that was captured.
        if (
          !item ||
          !root.contains(range.startContainer) ||
          !root.contains(range.endContainer) ||
          range.collapsed ||
          range.toString() !== item.exactText
        )
          ranges.delete(id);
      }

      const unresolved = items.filter((item) => !ranges.has(item.id));
      if (unresolved.length > 0) {
        const loaded = loadedAnchors(root);
        for (const annotation of unresolved) {
          // A block that has not been paginated in yet cannot hold the passage,
          // and findPassageRange would scan every loaded block to learn that.
          if (!loaded.has(annotation.anchor)) continue;
          const range = findPassageRange(root, annotation);
          if (range) ranges.set(annotation.id, range);
        }
      }

      const next: AnchoredPassage[] = [];
      for (const item of items) {
        const range = ranges.get(item.id);
        if (range) next.push({ id: item.id, range });
      }
      setAnchored((current) => (sameAnchors(current, next) ? current : next));
    },
    [containerRef],
  );

  useEffect(() => {
    const root = containerRef.current;
    if (!root || visible.length === 0) return;
    resolvePassages(visible);

    // Judgment bodies paginate, so an unresolved passage is usually text that
    // has not arrived rather than text that changed. Re-resolve as it lands.
    let timer: number | null = null;
    const observer = new MutationObserver(() => {
      if (timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        resolvePassages(visible);
      }, RESOLVE_DEBOUNCE_MS);
    });
    observer.observe(root, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [containerRef, resolvePassages, visible]);

  useEffect(() => {
    if (!canPaint) return;
    const registry = (CSS as unknown as { highlights?: HighlightRegistry })
      .highlights;
    const HighlightClass = (
      window as unknown as { Highlight?: HighlightConstructor }
    ).Highlight;
    if (!registry || !HighlightClass) return;

    const ranges = new Map(anchored.map((entry) => [entry.id, entry.range]));
    const byToken = new Map<string, Range[]>();
    for (const annotation of visible) {
      const range = ranges.get(annotation.id);
      if (!range) continue;
      const token = annotationLabelToken(annotation.label);
      const group = byToken.get(token);
      if (group) group.push(range);
      else byToken.set(token, [range]);
    }

    const names: string[] = [];
    for (const [token, group] of byToken) {
      const name = `${HIGHLIGHT_PREFIX}${token}`;
      registry.set(name, new HighlightClass(...group));
      names.push(name);
    }

    const activeRange = activeId ? ranges.get(activeId) : undefined;
    if (activeRange) {
      const highlight = new HighlightClass(activeRange);
      // Wherever annotations overlap, the one being read wins.
      highlight.priority = 1;
      registry.set(ACTIVE_HIGHLIGHT, highlight);
      names.push(ACTIVE_HIGHLIGHT);
    }

    return () => {
      for (const name of names) registry.delete(name);
    };
  }, [activeId, anchored, canPaint, visible]);

  // ::highlight() paints no boxes of its own, so a painted passage is opened by
  // hit-testing the click against the ranges the browser laid out.
  useEffect(() => {
    const root = containerRef.current;
    if (!root || anchored.length === 0) return;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      if ((event.target as Element | null)?.closest("a, button, input, select"))
        return;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;
      const id = passageAtPoint(anchored, event.clientX, event.clientY);
      if (id) setActiveId(id);
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, [anchored, containerRef]);

  const statuses = useMemo(() => {
    const anchoredIds = new Set(anchored.map((entry) => entry.id));
    const next: Record<string, AnnotationStatus> = {};
    for (const annotation of visible) {
      next[annotation.id] = anchoredIds.has(annotation.id)
        ? "anchored"
        : isFullyLoaded
          ? "orphaned"
          : "pending";
    }
    return next;
  }, [anchored, isFullyLoaded, visible]);

  const ranges = useMemo(
    () => new Map(anchored.map((entry) => [entry.id, entry.range])),
    [anchored],
  );

  const open = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const close = useCallback(() => {
    setActiveId(null);
  }, []);

  const replace = useCallback((annotation: DocumentAnnotation) => {
    setAnnotations((items) =>
      items.map((item) => (item.id === annotation.id ? annotation : item)),
    );
  }, []);

  const remove = useCallback((id: string) => {
    rangesRef.current.delete(id);
    setAnchored((current) => current.filter((entry) => entry.id !== id));
    setAnnotations((items) => items.filter((item) => item.id !== id));
    setActiveId((current) => (current === id ? null : current));
  }, []);

  return {
    ownerId,
    annotations: visible,
    statuses,
    ranges,
    activeId,
    open,
    close,
    replace,
    remove,
    highlightsPainted: canPaint,
    error: ownerStateIsCurrent ? error : null,
  };
}

/** One pass over the loaded blocks; an anchor absent from it cannot resolve. */
function loadedAnchors(root: HTMLElement): Set<string> {
  const anchors = new Set<string>();
  for (const element of root.querySelectorAll<HTMLElement>(
    "[data-section-id]",
  )) {
    const { quoteAnchor, sectionId } = element.dataset;
    if (sectionId) anchors.add(sectionId);
    if (quoteAnchor) anchors.add(quoteAnchor);
  }
  return anchors;
}

function sameAnchors(a: AnchoredPassage[], b: AnchoredPassage[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (entry, index) =>
        entry.id === b[index].id && entry.range === b[index].range,
    )
  );
}

/**
 * Nested and adjacent annotations both put several ranges under one point; the
 * smallest painted area is the most specific one the reader aimed at.
 */
function passageAtPoint(
  passages: AnchoredPassage[],
  x: number,
  y: number,
): string | null {
  let best: { id: string; area: number } | null = null;
  for (const { id, range } of passages) {
    let hit = false;
    let area = 0;
    for (const rect of range.getClientRects()) {
      area += rect.width * rect.height;
      if (
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom
      )
        hit = true;
    }
    if (hit && (!best || area < best.area)) best = { id, area };
  }
  return best?.id ?? null;
}
