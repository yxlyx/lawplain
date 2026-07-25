"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ANNOTATION_LABELS,
  annotationLabelToken,
  resolveAnnotationLabel,
} from "@/lib/annotation-labels";
import { authClient } from "@/lib/auth-client";
import { formatCopiedQuote } from "@/lib/research-export";

/** Label id -> display name, for a copied quote (#198). */
const LABEL_NAMES: Record<string, string> = Object.fromEntries(
  ANNOTATION_LABELS.map((label) => [label.id, label.name]),
);

type FollowUp = {
  annotationId: string;
  note: string | null;
  dueAt: number | null;
  resolvedAt: number | null;
  overdue: boolean;
};

type Annotation = {
  id: string;
  docType: "judgment" | "statute";
  docId: string;
  title: string;
  citation: string;
  path: string;
  exactText: string;
  note: string | null;
  label: string;
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

/** Colour is an aid only; the name beside it is what carries the meaning. */
function LabelChip({ label }: { label: string }) {
  const resolved = resolveAnnotationLabel(label);
  const token = annotationLabelToken(label);
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted">
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 shrink-0 rounded-full border"
        style={{
          backgroundColor: `var(--annotation-${token})`,
          borderColor: `var(--annotation-${token}-ink)`,
        }}
      />
      {resolved.name}
    </span>
  );
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
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [followUps, setFollowUps] = useState<Record<string, FollowUp>>({});
  const requestVersion = useRef(0);
  const paginationController = useRef<AbortController | null>(null);

  /**
   * Copy a passage with its citation, deep link and label. The reader's own note
   * is only included when they pick the button that says so (#198).
   */
  async function copyQuote(annotation: Annotation, includeNote: boolean) {
    const text = formatCopiedQuote(
      { title: annotation.title, citation: annotation.citation },
      {
        annotationId: annotation.id,
        exactText: annotation.exactText,
        note: annotation.note,
        label: annotation.label,
        path: annotation.path,
        startOffset: 0,
        endOffset: annotation.exactText.length,
        createdAt: annotation.createdAt,
        updatedAt: annotation.updatedAt,
      },
      LABEL_NAMES,
      { includeNote, origin: window.location.origin },
    );
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(`${annotation.id}:${includeNote}`);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      setError("Could not copy. Your clipboard blocked the request.");
    }
  }

  /** Open, resolve or reopen a follow-up on one passage (#199). */
  async function toggleFollowUp(
    annotation: Annotation,
    change: { resolved?: boolean; open?: boolean },
  ) {
    setBusyId(annotation.id);
    setError(null);
    try {
      const response = await fetch("/api/follow-ups", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          annotationId: annotation.id,
          resolved: change.resolved ?? false,
          ...(change.open ? { note: null } : {}),
        }),
      });
      if (!response.ok) throw new Error("Could not update the follow-up.");
      const body = (await response.json()) as { followUp: FollowUp };
      setFollowUps((current) => ({
        ...current,
        [annotation.id]: body.followUp,
      }));
      announceLibraryChanged();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not update the follow-up.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function clearFollowUp(annotation: Annotation) {
    setBusyId(annotation.id);
    try {
      await fetch(
        `/api/follow-ups?annotationId=${encodeURIComponent(annotation.id)}`,
        { method: "DELETE" },
      );
      setFollowUps((current) => {
        const next = { ...current };
        delete next[annotation.id];
        return next;
      });
      announceLibraryChanged();
    } catch {
      setError("Could not remove the follow-up.");
    } finally {
      setBusyId(null);
    }
  }

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

    // Follow-up state lives beside the annotation, not on it, so it loads on its
    // own. A failure here leaves the annotations usable and simply shows none.
    async function loadFollowUps() {
      try {
        const response = await fetch("/api/follow-ups?state=all", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const body = (await response.json()) as { followUps: FollowUp[] };
        if (controller.signal.aborted || version !== requestVersion.current)
          return;
        setFollowUps(
          Object.fromEntries(
            (body.followUps ?? []).map((f) => [f.annotationId, f]),
          ),
        );
      } catch {
        // Non-fatal.
      }
    }

    void load();
    void loadFollowUps();
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

  async function relabel(annotation: Annotation, label: string) {
    if (busyId || label === annotation.label) return;
    const version = requestVersion.current;
    setBusyId(annotation.id);
    setError(null);
    try {
      const response = await fetch(
        `/api/annotations/${encodeURIComponent(annotation.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label }),
        },
      );
      if (!response.ok) throw new Error("Could not change the label.");
      const data = (await response.json()) as { annotation: Annotation };
      if (version !== requestVersion.current) return;
      setAnnotations((items) =>
        items.map((item) =>
          item.id === annotation.id ? data.annotation : item,
        ),
      );
      announceLibraryChanged();
    } catch (caught) {
      if (version !== requestVersion.current) return;
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not change the label.",
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
              <LabelChip label={annotation.label} />
              <Link
                href={annotationTargetPath(annotation)}
                aria-label={`Open annotation in ${annotation.title}`}
                className="mt-2 block rounded-md hover:text-accent"
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

              <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                <label
                  htmlFor={`annotation-label-${annotation.id}`}
                  className="mr-auto text-xs text-muted-2"
                >
                  Label
                </label>
                <select
                  id={`annotation-label-${annotation.id}`}
                  value={annotation.label}
                  onChange={(event) =>
                    void relabel(annotation, event.target.value)
                  }
                  disabled={busyId === annotation.id}
                  className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted disabled:opacity-60"
                >
                  {ANNOTATION_LABELS.some(
                    (item) => item.id === annotation.label,
                  ) ? null : (
                    <option value={annotation.label}>
                      {resolveAnnotationLabel(annotation.label).name}
                    </option>
                  )}
                  {ANNOTATION_LABELS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void copyQuote(annotation, false)}
                  className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted hover:border-accent hover:text-accent"
                >
                  {copiedId === `${annotation.id}:false` ? "Copied" : "Copy"}
                </button>
                {annotation.note && (
                  // A separate control, so including a private note is always an
                  // explicit choice rather than a default (#198).
                  <button
                    type="button"
                    onClick={() => void copyQuote(annotation, true)}
                    className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted hover:border-accent hover:text-accent"
                  >
                    {copiedId === `${annotation.id}:true`
                      ? "Copied"
                      : "Copy with my note"}
                  </button>
                )}
                {(() => {
                  const followUp = followUps[annotation.id];
                  if (!followUp) {
                    return (
                      <button
                        type="button"
                        onClick={() =>
                          void toggleFollowUp(annotation, { open: true })
                        }
                        disabled={busyId === annotation.id}
                        className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted hover:border-accent hover:text-accent disabled:opacity-60"
                      >
                        Follow up
                      </button>
                    );
                  }
                  const open = followUp.resolvedAt === null;
                  return (
                    <>
                      <span
                        className={
                          open
                            ? "rounded-full bg-warning-soft px-2.5 py-1 text-[11px] font-medium text-warning"
                            : "rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-muted-2"
                        }
                      >
                        {open
                          ? followUp.overdue
                            ? "Follow-up overdue"
                            : "Following up"
                          : "Resolved"}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          void toggleFollowUp(annotation, { resolved: open })
                        }
                        disabled={busyId === annotation.id}
                        className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted hover:border-accent hover:text-accent disabled:opacity-60"
                      >
                        {open ? "Resolve" : "Reopen"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void clearFollowUp(annotation)}
                        disabled={busyId === annotation.id}
                        className="rounded-full px-2.5 py-1.5 text-xs font-medium text-muted hover:bg-surface-2 disabled:opacity-60"
                      >
                        Remove follow-up
                      </button>
                    </>
                  );
                })()}
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
                  className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted hover:border-danger-border hover:text-danger disabled:opacity-60"
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
