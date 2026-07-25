"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { XIcon } from "@/components/icons";
import { ResearchGroupPicker } from "@/components/ResearchGroupPicker";
import { SavedFeatureAuthPrompt } from "@/components/SavedFeatureAuthPrompt";
import {
  ANNOTATION_LABELS,
  annotationLabelToken,
  resolveAnnotationLabel,
} from "@/lib/annotation-labels";
import { authClient } from "@/lib/auth-client";

type LibraryAuthority = {
  id: string;
  docType: "judgment" | "statute";
  docId: string;
  title: string;
  citation: string;
  path: string;
  savedAt: number | null;
  createdAt: number;
  activityAt: number;
  annotationCount: number;
  passageNoteCount: number;
  documentNoteCount: number;
  lastAnnotationAt: number | null;
  labels: string[];
  notePreview: string | null;
  openFollowUpCount: number;
  tags: string[];
  collections: string[];
};

type LibraryPage = {
  authorities: LibraryAuthority[];
  nextCursor: string | null;
};

type LibraryFilterState = {
  docType: "" | "judgment" | "statute";
  label: string;
  hasPassageNotes: boolean;
  hasDocumentNote: boolean;
  hasOpenFollowUps: boolean;
  sort: "activity" | "saved" | "title";
};

const NO_FILTERS: LibraryFilterState = {
  docType: "",
  label: "",
  hasPassageNotes: false,
  hasDocumentNote: false,
  hasOpenFollowUps: false,
  sort: "activity",
};

/** Previews are remembered per browser, and default to hidden. */
const PREVIEW_KEY = "lawplain:library-previews";

function filtersActive(filters: LibraryFilterState): boolean {
  return (
    filters.docType !== "" ||
    filters.label !== "" ||
    filters.hasPassageNotes ||
    filters.hasDocumentNote ||
    filters.hasOpenFollowUps ||
    filters.sort !== "activity"
  );
}

type UndoToast = {
  item: LibraryAuthority;
  message: string;
};

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(timestamp));
}

function docLabel(docType: LibraryAuthority["docType"]): string {
  return docType === "judgment" ? "Judgment" : "Statute";
}

export function SavedWorkspace() {
  const { data: session, isPending } = authClient.useSession();
  const ownerId = session?.user.id ?? null;
  const [dataOwnerId, setDataOwnerId] = useState<string | null>(null);
  const [authorities, setAuthorities] = useState<LibraryAuthority[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [undoToast, setUndoToast] = useState<UndoToast | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [filters, setFilters] = useState<LibraryFilterState>(NO_FILTERS);
  const [showPreviews, setShowPreviews] = useState(false);
  const filterId = useId();
  const undoTimer = useRef<number | null>(null);
  const removeInFlight = useRef(false);
  const loadVersion = useRef(0);
  const ownerVersion = useRef(0);
  const paginationController = useRef<AbortController | null>(null);
  const removeController = useRef<AbortController | null>(null);
  const undoController = useRef<AbortController | null>(null);
  const ownerStateIsCurrent = dataOwnerId === ownerId;
  const visibleAuthorities = ownerStateIsCurrent ? authorities : [];
  const visibleNextCursor = ownerStateIsCurrent ? nextCursor : null;
  const visibleUndoToast = ownerStateIsCurrent ? undoToast : null;

  const loadLibrary = useCallback(
    async ({
      cursor,
      append,
      signal,
    }: {
      cursor?: string | null;
      append?: boolean;
      signal?: AbortSignal;
    } = {}) => {
      if (!ownerId) return;
      const requestOwnerVersion = ownerVersion.current;
      const requestVersion = append
        ? loadVersion.current
        : ++loadVersion.current;
      append ? setLoadingMore(true) : setLoading(true);
      setError(null);
      setAuthRequired(false);
      try {
        const search = new URLSearchParams();
        if (cursor) search.set("cursor", cursor);
        if (filters.docType) search.set("docType", filters.docType);
        if (filters.label) search.set("label", filters.label);
        if (filters.hasPassageNotes) search.set("hasPassageNotes", "true");
        if (filters.hasDocumentNote) search.set("hasDocumentNote", "true");
        if (filters.hasOpenFollowUps) search.set("hasOpenFollowUps", "true");
        if (filters.sort !== "activity") search.set("sort", filters.sort);
        // Asking for previews is the opt-in: hidden means the note text is never
        // selected server-side, not merely left unrendered here.
        if (showPreviews) search.set("preview", "true");
        const query = search.size > 0 ? `?${search}` : "";
        const response = await fetch(`/api/library${query}`, {
          cache: "no-store",
          signal,
        });
        if (
          signal?.aborted ||
          requestVersion !== loadVersion.current ||
          requestOwnerVersion !== ownerVersion.current
        )
          return;
        if (response.status === 401) {
          setAuthorities([]);
          setNextCursor(null);
          setAuthRequired(true);
          return;
        }
        if (!response.ok) throw new Error("Could not load saved research.");
        const data = (await response.json()) as LibraryPage;
        setAuthorities((items) =>
          append ? [...items, ...(data.authorities ?? [])] : data.authorities,
        );
        setNextCursor(data.nextCursor ?? null);
      } catch (caught) {
        if (
          requestVersion === loadVersion.current &&
          requestOwnerVersion === ownerVersion.current &&
          !(caught instanceof DOMException && caught.name === "AbortError")
        ) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Could not load saved research.",
          );
        }
      } finally {
        if (
          requestVersion === loadVersion.current &&
          requestOwnerVersion === ownerVersion.current
        ) {
          if (append) setLoadingMore(false);
          else setLoading(false);
        }
      }
    },
    // Changing a filter or the preview choice re-runs the load effect below,
    // which resets the list first so a filtered page never mixes with an old one.
    [ownerId, filters, showPreviews],
  );

  useEffect(() => {
    return () => {
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
    };
  }, []);

  useEffect(() => {
    try {
      setShowPreviews(window.localStorage.getItem(PREVIEW_KEY) === "true");
    } catch {
      // A blocked storage API is not a reason to fail; previews stay hidden.
    }
  }, []);

  useEffect(() => {
    ownerVersion.current += 1;
    loadVersion.current += 1;
    paginationController.current?.abort();
    removeController.current?.abort();
    undoController.current?.abort();
    paginationController.current = null;
    removeController.current = null;
    undoController.current = null;
    removeInFlight.current = false;
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    setDataOwnerId(ownerId);
    setAuthorities([]);
    setNextCursor(null);
    setError(null);
    setLoading(false);
    setLoadingMore(false);
    setAuthRequired(false);
    setUndoToast(null);
    setRemovingId(null);
    if (!ownerId) return;

    const controller = new AbortController();
    void loadLibrary({ signal: controller.signal });
    return () => {
      controller.abort();
      paginationController.current?.abort();
      removeController.current?.abort();
      undoController.current?.abort();
      ownerVersion.current += 1;
      loadVersion.current += 1;
    };
  }, [loadLibrary, ownerId]);

  useEffect(() => {
    function refreshLibrary() {
      void loadLibrary();
    }
    window.addEventListener("lawplain:library-changed", refreshLibrary);
    return () =>
      window.removeEventListener("lawplain:library-changed", refreshLibrary);
  }, [loadLibrary]);

  const choosePreviews = useCallback((next: boolean) => {
    setShowPreviews(next);
    try {
      window.localStorage.setItem(PREVIEW_KEY, String(next));
    } catch {
      // Remembering the choice is a convenience, not a requirement.
    }
  }, []);

  function showUndoToast(item: LibraryAuthority, version: number) {
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    setUndoToast({
      item,
      message: `${docLabel(item.docType)} unsaved.`,
    });
    undoTimer.current = window.setTimeout(() => {
      if (version === ownerVersion.current) setUndoToast(null);
    }, 5000);
  }

  async function removeAuthority(item: LibraryAuthority) {
    if (!ownerStateIsCurrent || removeInFlight.current) return;
    const version = ownerVersion.current;
    const controller = new AbortController();
    removeController.current?.abort();
    removeController.current = controller;
    removeInFlight.current = true;
    setRemovingId(item.id);
    setError(null);
    setAuthorities((items) =>
      item.annotationCount > 0
        ? items.map((candidate) =>
            candidate.id === item.id
              ? { ...candidate, savedAt: null }
              : candidate,
          )
        : items.filter((candidate) => candidate.id !== item.id),
    );

    try {
      const response = await fetch(
        `/api/saved?docType=${item.docType}&docId=${encodeURIComponent(item.docId)}`,
        { method: "DELETE", signal: controller.signal },
      );
      if (!response.ok) throw new Error("Could not remove saved document.");
      if (controller.signal.aborted || version !== ownerVersion.current) return;
      showUndoToast(item, version);
    } catch (caught) {
      if (controller.signal.aborted || version !== ownerVersion.current) return;
      setAuthorities((items) => [
        item,
        ...items.filter((candidate) => candidate.id !== item.id),
      ]);
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not remove saved document.",
      );
    } finally {
      if (removeController.current === controller)
        removeController.current = null;
      if (version === ownerVersion.current) {
        removeInFlight.current = false;
        setRemovingId(null);
      }
    }
  }

  async function undoRemove() {
    if (!visibleUndoToast || !ownerStateIsCurrent) return;
    const version = ownerVersion.current;
    const controller = new AbortController();
    undoController.current?.abort();
    undoController.current = controller;
    const { item } = visibleUndoToast;
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    setUndoToast(null);
    setError(null);

    try {
      const response = await fetch("/api/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docType: item.docType,
          docId: item.docId,
          title: item.title,
          citation: item.citation,
          path: item.path,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Could not restore saved document.");
      const data = (await response.json()) as {
        saved?: Partial<LibraryAuthority>;
      };
      if (controller.signal.aborted || version !== ownerVersion.current) return;
      const restored = { ...item, ...data.saved };
      setAuthorities((items) => {
        const existing = items.some((candidate) => candidate.id === item.id);
        return existing
          ? items.map((candidate) =>
              candidate.id === item.id ? restored : candidate,
            )
          : [restored, ...items];
      });
    } catch (caught) {
      if (controller.signal.aborted || version !== ownerVersion.current) return;
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not restore saved document.",
      );
    } finally {
      if (undoController.current === controller) undoController.current = null;
    }
  }

  async function loadMore() {
    if (!visibleNextCursor || loadingMore || !ownerStateIsCurrent) return;
    const controller = new AbortController();
    paginationController.current?.abort();
    paginationController.current = controller;
    try {
      await loadLibrary({
        cursor: visibleNextCursor,
        append: true,
        signal: controller.signal,
      });
    } finally {
      if (paginationController.current === controller)
        paginationController.current = null;
    }
  }

  if (isPending) {
    return (
      <p className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted">
        Loading saved workspace…
      </p>
    );
  }

  if (!ownerId || (ownerStateIsCurrent && authRequired)) {
    return (
      <SavedFeatureAuthPrompt
        next="/saved"
        title="Sign in or create an account to use Saved"
        body="Saved documents and private annotations are visible only to your account."
      />
    );
  }

  if (!ownerStateIsCurrent || (loading && visibleAuthorities.length === 0)) {
    return (
      <p className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted">
        Loading saved workspace…
      </p>
    );
  }

  return (
    <>
      <section className="rounded-2xl border border-border bg-surface p-5">
        {error && (
          <p
            role="alert"
            className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
          >
            {error}
          </p>
        )}
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-xl font-medium text-foreground">
              Saved documents
            </h2>
            <p className="mt-1 text-xs text-muted-2">
              Bookmarks and documents with private annotations
            </p>
          </div>
          <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted-2">
            {visibleAuthorities.length} {visibleNextCursor ? "loaded" : "total"}
          </span>
        </div>

        <fieldset className="mb-4 flex flex-wrap items-center gap-2 border-b border-border pb-4">
          <legend className="sr-only">Filter and sort your library</legend>
          <label className="sr-only" htmlFor={`${filterId}-type`}>
            Document type
          </label>
          <select
            id={`${filterId}-type`}
            value={filters.docType}
            onChange={(event) =>
              setFilters((f) => ({
                ...f,
                docType: event.target.value as LibraryFilterState["docType"],
              }))
            }
            className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted"
          >
            <option value="">All documents</option>
            <option value="judgment">Judgments</option>
            <option value="statute">Statutes</option>
          </select>

          <label className="sr-only" htmlFor={`${filterId}-label`}>
            Annotation label
          </label>
          <select
            id={`${filterId}-label`}
            value={filters.label}
            onChange={(event) =>
              setFilters((f) => ({ ...f, label: event.target.value }))
            }
            className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted"
          >
            <option value="">Any label</option>
            {ANNOTATION_LABELS.map((label) => (
              <option key={label.id} value={label.id}>
                {label.name}
              </option>
            ))}
          </select>

          <label className="sr-only" htmlFor={`${filterId}-sort`}>
            Sort by
          </label>
          <select
            id={`${filterId}-sort`}
            value={filters.sort}
            onChange={(event) =>
              setFilters((f) => ({
                ...f,
                sort: event.target.value as LibraryFilterState["sort"],
              }))
            }
            className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted"
          >
            <option value="activity">Recently active</option>
            <option value="saved">Date saved</option>
            <option value="title">Title</option>
          </select>

          {(
            [
              ["hasPassageNotes", "Has passage notes"],
              ["hasDocumentNote", "Has document note"],
              ["hasOpenFollowUps", "Unresolved follow-ups"],
            ] as const
          ).map(([key, text]) => (
            <button
              key={key}
              type="button"
              aria-pressed={filters[key]}
              onClick={() => setFilters((f) => ({ ...f, [key]: !f[key] }))}
              className={
                filters[key]
                  ? "rounded-full border border-accent bg-accent/10 px-3 py-1 text-xs font-medium text-foreground"
                  : "rounded-full border border-border px-3 py-1 text-xs font-medium text-muted hover:border-accent hover:text-foreground"
              }
            >
              {text}
            </button>
          ))}

          <button
            type="button"
            aria-pressed={showPreviews}
            onClick={() => choosePreviews(!showPreviews)}
            className={
              showPreviews
                ? "rounded-full border border-accent bg-accent/10 px-3 py-1 text-xs font-medium text-foreground"
                : "rounded-full border border-border px-3 py-1 text-xs font-medium text-muted hover:border-accent hover:text-foreground"
            }
          >
            {showPreviews ? "Hide note previews" : "Show note previews"}
          </button>

          {filtersActive(filters) && (
            <button
              type="button"
              onClick={() => setFilters(NO_FILTERS)}
              className="rounded-full px-3 py-1 text-xs font-medium text-muted underline hover:text-foreground"
            >
              Clear filters
            </button>
          )}

          {/* Export (#198). Notes are a separate choice, never the default, and
              the download is generated per request rather than stored. */}
          <span className="ml-auto flex items-center gap-1.5">
            <a
              href="/api/research-export?format=md"
              download
              className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted hover:border-accent hover:text-foreground"
            >
              Export Markdown
            </a>
            <a
              href="/api/research-export?format=json"
              download
              className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted hover:border-accent hover:text-foreground"
            >
              JSON
            </a>
            <a
              href="/api/research-export?format=md&includeNotes=true"
              download
              className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted hover:border-accent hover:text-foreground"
              title="Includes the text of your private notes"
            >
              Export with my notes
            </a>
          </span>
        </fieldset>
        {visibleAuthorities.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-strong p-5 text-sm text-muted">
            {filtersActive(filters) ? (
              <>
                <p className="font-medium text-foreground">
                  No documents match these filters.
                </p>
                <p className="mt-1">
                  Your library is not empty — the filters above are narrowing
                  it.
                </p>
                <button
                  type="button"
                  onClick={() => setFilters(NO_FILTERS)}
                  className="mt-3 inline-flex rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted transition-colors hover:border-accent hover:text-accent"
                >
                  Clear filters
                </button>
              </>
            ) : (
              <>
                <p className="font-medium text-foreground">
                  Nothing saved yet.
                </p>
                <p className="mt-1">
                  Save a document or annotate a passage and it will appear here.
                </p>
                <Link
                  href="/"
                  className="mt-3 inline-flex rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted transition-colors hover:border-accent hover:text-accent"
                >
                  Go to Search
                </Link>
              </>
            )}
          </div>
        ) : (
          <ul className="space-y-3">
            {visibleAuthorities.map((item) => (
              <li
                key={item.id}
                className="relative rounded-xl border border-border bg-background transition-colors hover:border-border-strong hover:bg-surface-2"
              >
                <Link href={item.path} className="block p-4 pr-14">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">
                    {docLabel(item.docType)}
                  </span>
                  <span className="mt-1 block font-serif text-lg font-medium leading-snug text-foreground">
                    {item.title}
                  </span>
                  {item.citation && (
                    <span className="mt-1 block text-xs text-muted">
                      {item.citation}
                    </span>
                  )}
                  <span className="mt-2 block text-xs text-muted-2">
                    {item.savedAt
                      ? `Saved ${formatDate(item.savedAt)}`
                      : `Added from an annotation ${formatDate(item.createdAt)}`}
                    {` · ${item.annotationCount} annotation${item.annotationCount === 1 ? "" : "s"}`}
                    {item.passageNoteCount > 0 &&
                      ` · ${item.passageNoteCount} passage note${item.passageNoteCount === 1 ? "" : "s"}`}
                    {item.documentNoteCount > 0 && " · Document note"}
                    {` · Active ${formatDate(item.activityAt)}`}
                  </span>
                  {item.labels.length > 0 && (
                    <span className="mt-2 flex flex-wrap items-center gap-1.5">
                      {item.labels.map((id) => {
                        const label = resolveAnnotationLabel(id);
                        return (
                          // Colour is never the label: the name always renders too.
                          <span
                            key={id}
                            className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-muted-2"
                          >
                            <span
                              aria-hidden="true"
                              className="h-2 w-2 shrink-0 rounded-full border"
                              style={{
                                background: `var(--annotation-${annotationLabelToken(id)})`,
                                borderColor: `var(--annotation-${annotationLabelToken(id)}-ink)`,
                              }}
                            />
                            {label.name}
                          </span>
                        );
                      })}
                    </span>
                  )}
                  {(item.tags.length > 0 || item.collections.length > 0) && (
                    <span className="mt-1.5 block text-[11px] text-muted-2">
                      {item.collections.length > 0 &&
                        `In ${item.collections.join(", ")}`}
                      {item.collections.length > 0 &&
                        item.tags.length > 0 &&
                        " · "}
                      {item.tags.length > 0 && `Tagged ${item.tags.join(", ")}`}
                    </span>
                  )}
                  {item.openFollowUpCount > 0 && (
                    <span className="mt-1.5 inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                      {item.openFollowUpCount} unresolved follow-up
                      {item.openFollowUpCount === 1 ? "" : "s"}
                    </span>
                  )}
                  {item.notePreview && (
                    <span className="mt-2 block border-l-2 border-accent/50 pl-2.5 text-[11px] italic text-muted">
                      Your note: {item.notePreview}
                    </span>
                  )}
                </Link>
                {/* Tags and collections (#197). Outside the Link so the card
                    stays a single navigation target. */}
                <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3">
                  <ResearchGroupPicker
                    authorityId={item.id}
                    kind="tag"
                    onChanged={() => void loadLibrary()}
                  />
                  <ResearchGroupPicker
                    authorityId={item.id}
                    kind="collection"
                    onChanged={() => void loadLibrary()}
                  />
                </div>
                {item.savedAt && (
                  <button
                    type="button"
                    onClick={() => void removeAuthority(item)}
                    disabled={removingId !== null}
                    aria-label={`Unsave ${item.title}`}
                    title="Unsave"
                    className="absolute right-3 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-2 transition-colors hover:bg-border hover:text-foreground disabled:opacity-50"
                  >
                    <XIcon className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {visibleNextCursor && (
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="mt-4 w-full rounded-xl border border-border bg-background px-4 py-2 text-sm font-medium text-muted hover:border-accent hover:text-accent disabled:opacity-60"
          >
            {loadingMore ? "Loading…" : "Load more documents"}
          </button>
        )}
      </section>

      {visibleUndoToast && (
        <output
          aria-live="polite"
          className="fixed bottom-5 left-1/2 z-50 flex w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 items-center justify-between gap-3 rounded-2xl border border-border bg-foreground px-4 py-3 text-sm text-background shadow-lg"
        >
          <span>{visibleUndoToast.message}</span>
          <button
            type="button"
            onClick={() => void undoRemove()}
            className="shrink-0 rounded-full bg-background px-3 py-1 text-xs font-semibold text-foreground transition-opacity hover:opacity-80"
          >
            Undo
          </button>
        </output>
      )}
    </>
  );
}
