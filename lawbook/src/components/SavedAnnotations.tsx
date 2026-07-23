"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";

type Annotation = {
  id: string;
  docType: "judgment" | "statute";
  docId: string;
  title: string;
  citation: string;
  path: string;
  exactText: string;
  note: string | null;
  createdAt: number;
  updatedAt: number;
};

type AnnotationPage = {
  annotations: Annotation[];
  nextCursor: string | null;
};

function annotationTargetPath(annotation: Annotation) {
  const url = new URL(annotation.path, "https://lawplain.invalid");
  url.searchParams.set("savedQuote", annotation.id);
  return `${url.pathname}${url.search}${url.hash}`;
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(timestamp));
}

function announceLibraryChanged() {
  window.dispatchEvent(new Event("lawplain:library-changed"));
}

export function SavedAnnotations() {
  const { data: session } = authClient.useSession();
  const ownerId = session?.user.id ?? null;
  const [dataOwnerId, setDataOwnerId] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const paginationController = useRef<AbortController | null>(null);

  useEffect(() => {
    const version = ++requestVersion.current;
    paginationController.current?.abort();
    setDataOwnerId(ownerId);
    setAnnotations([]);
    setNextCursor(null);
    setLoadingMore(false);
    setBusyId(null);
    setEditingId(null);
    setNoteDraft("");
    setError(null);
    if (!ownerId) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      try {
        const response = await fetch("/api/annotations", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Could not load annotations.");
        const data = (await response.json()) as AnnotationPage;
        if (controller.signal.aborted || version !== requestVersion.current)
          return;
        setAnnotations(data.annotations ?? []);
        setNextCursor(data.nextCursor ?? null);
      } catch (caught) {
        if (!controller.signal.aborted && version === requestVersion.current) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Could not load annotations.",
          );
        }
      } finally {
        if (!controller.signal.aborted && version === requestVersion.current)
          setLoading(false);
      }
    }

    void load();
    return () => {
      controller.abort();
      paginationController.current?.abort();
      requestVersion.current += 1;
    };
  }, [ownerId]);

  if (!ownerId) return null;
  const ownerStateIsCurrent = dataOwnerId === ownerId;
  const visibleAnnotations = ownerStateIsCurrent ? annotations : [];
  const visibleNextCursor = ownerStateIsCurrent ? nextCursor : null;

  async function loadMore() {
    if (!visibleNextCursor || loadingMore) return;
    const version = requestVersion.current;
    const controller = new AbortController();
    paginationController.current?.abort();
    paginationController.current = controller;
    setLoadingMore(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/annotations?cursor=${encodeURIComponent(visibleNextCursor)}`,
        { cache: "no-store", signal: controller.signal },
      );
      if (!response.ok) throw new Error("Could not load more annotations.");
      const data = (await response.json()) as AnnotationPage;
      if (controller.signal.aborted || version !== requestVersion.current)
        return;
      setAnnotations((items) => [...items, ...(data.annotations ?? [])]);
      setNextCursor(data.nextCursor ?? null);
    } catch (caught) {
      if (!controller.signal.aborted && version === requestVersion.current) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not load more annotations.",
        );
      }
    } finally {
      if (!controller.signal.aborted && version === requestVersion.current)
        setLoadingMore(false);
      if (paginationController.current === controller)
        paginationController.current = null;
    }
  }

  function beginEditing(annotation: Annotation) {
    setEditingId(annotation.id);
    setNoteDraft(annotation.note ?? "");
    setError(null);
  }

  async function saveNote(annotation: Annotation) {
    if (busyId) return;
    const version = requestVersion.current;
    setBusyId(annotation.id);
    setError(null);
    try {
      const response = await fetch(
        `/api/annotations/${encodeURIComponent(annotation.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: noteDraft || null }),
        },
      );
      if (!response.ok) throw new Error("Could not update private note.");
      const data = (await response.json()) as { annotation: Annotation };
      if (version !== requestVersion.current) return;
      setAnnotations((items) =>
        items.map((item) =>
          item.id === annotation.id ? data.annotation : item,
        ),
      );
      setEditingId(null);
      announceLibraryChanged();
    } catch (caught) {
      if (version !== requestVersion.current) return;
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not update private note.",
      );
    } finally {
      if (version === requestVersion.current) setBusyId(null);
    }
  }

  async function remove(annotation: Annotation) {
    if (
      busyId ||
      !window.confirm(
        "Permanently delete this annotation and its private note? This cannot be undone.",
      )
    )
      return;
    const version = requestVersion.current;
    setBusyId(annotation.id);
    setError(null);
    try {
      const response = await fetch(
        `/api/annotations/${encodeURIComponent(annotation.id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error("Could not delete annotation.");
      if (version !== requestVersion.current) return;
      setAnnotations((items) =>
        items.filter((item) => item.id !== annotation.id),
      );
      if (editingId === annotation.id) setEditingId(null);
      announceLibraryChanged();
    } catch (caught) {
      if (version !== requestVersion.current) return;
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not delete annotation.",
      );
    } finally {
      if (version === requestVersion.current) setBusyId(null);
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-border bg-surface p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-serif text-xl font-medium text-foreground">
          Private annotations
        </h2>
        <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted-2">
          {visibleAnnotations.length}
        </span>
      </div>
      {error && (
        <p role="alert" className="mb-3 text-sm text-accent">
          {error}
        </p>
      )}
      {loading ? (
        <p className="rounded-xl border border-dashed border-border-strong p-5 text-sm text-muted">
          Loading private annotations…
        </p>
      ) : visibleAnnotations.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border-strong p-5 text-sm text-muted">
          Select a passage in a judgment or statute, then choose Highlight or
          Add note.
        </p>
      ) : (
        <ul className="space-y-3">
          {visibleAnnotations.map((annotation) => (
            <li
              key={annotation.id}
              className="rounded-xl border border-border bg-background p-4"
            >
              <Link
                href={annotationTargetPath(annotation)}
                aria-label={`Open annotation in ${annotation.title}`}
                className="block rounded-md hover:text-accent"
              >
                <blockquote className="line-clamp-4 font-serif text-foreground transition-colors hover:text-accent">
                  “{annotation.exactText}”
                </blockquote>
              </Link>
              <div className="mt-3 text-xs text-muted">
                <Link
                  href={annotationTargetPath(annotation)}
                  className="font-medium hover:text-accent"
                >
                  {annotation.title}
                </Link>
                {annotation.citation && <span> · {annotation.citation}</span>}
                <span> · {formatDate(annotation.updatedAt)}</span>
              </div>

              {editingId === annotation.id ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveNote(annotation);
                  }}
                  className="mt-4 rounded-lg border border-border bg-surface p-3"
                >
                  <label
                    htmlFor={`annotation-note-${annotation.id}`}
                    className="text-xs font-semibold text-foreground"
                  >
                    Private note
                  </label>
                  <textarea
                    id={`annotation-note-${annotation.id}`}
                    value={noteDraft}
                    onChange={(event) => setNoteDraft(event.target.value)}
                    maxLength={10_000}
                    rows={4}
                    className="mt-2 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="rounded-full px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-2"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={busyId === annotation.id}
                      className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-primary-fg disabled:opacity-60"
                    >
                      {busyId === annotation.id ? "Saving…" : "Save note"}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="mt-4 rounded-lg border-l-2 border-accent/50 bg-surface px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">
                    Your private note
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted">
                    {annotation.note || "No note added."}
                  </p>
                </div>
              )}

              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => beginEditing(annotation)}
                  disabled={busyId === annotation.id}
                  className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted hover:border-accent hover:text-accent disabled:opacity-60"
                >
                  {annotation.note ? "Edit note" : "Add note"}
                </button>
                <button
                  type="button"
                  onClick={() => void remove(annotation)}
                  disabled={busyId === annotation.id}
                  className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted hover:border-red-300 hover:text-red-700 disabled:opacity-60"
                >
                  {busyId === annotation.id ? "Deleting…" : "Delete"}
                </button>
              </div>
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
          {loadingMore ? "Loading…" : "Load more annotations"}
        </button>
      )}
    </section>
  );
}
