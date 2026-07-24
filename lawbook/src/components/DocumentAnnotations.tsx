"use client";

import {
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  type AnnotationStatus,
  type DocumentAnnotation,
  useDocumentAnnotations,
} from "@/hooks/useDocumentAnnotations";
import {
  ANNOTATION_LABELS,
  annotationLabelToken,
  resolveAnnotationLabel,
} from "@/lib/annotation-labels";
import type { SavedDocType } from "@/lib/saved-workspace";

const MAX_NOTE_LENGTH = 10_000;

const STATUS_BADGE: Record<AnnotationStatus, string | null> = {
  anchored: null,
  pending: "Not loaded yet",
  orphaned: "Passage changed",
};

const STATUS_EXPLANATION: Record<AnnotationStatus, string | null> = {
  anchored: null,
  pending:
    "This passage sits below the text loaded so far. It is highlighted as soon as that part of the document loads.",
  orphaned:
    "This passage is no longer in the document text, so it cannot be shown in place. Your note is kept here rather than attached to a passage that only looks similar.",
};

/**
 * The reader's own annotations, restored into the document they were taken in:
 * a keyboard-reachable list of every annotation on the page and a card for the
 * one being read. Everything here is private to the signed-in owner.
 */
export function DocumentAnnotations({
  containerRef,
  docType,
  docId,
  isFullyLoaded,
  onRequestMore,
}: {
  containerRef: RefObject<HTMLElement | null>;
  docType: SavedDocType;
  docId: string;
  isFullyLoaded: boolean;
  /** Loads the next page of a paginated body so a pending passage can arrive. */
  onRequestMore?: () => void;
}) {
  const {
    ownerId,
    annotations,
    statuses,
    ranges,
    activeId,
    open,
    close,
    replace,
    remove,
    highlightsPainted,
    error,
  } = useDocumentAnnotations(containerRef, docType, docId, isFullyLoaded);
  const [listOpen, setListOpen] = useState(false);
  const openedFromList = useRef(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const active = annotations.find((item) => item.id === activeId) ?? null;

  // The list unmounts while a card covers it, so the item that opened the card
  // is gone by the time it closes; the pill that reopens the list is where
  // keyboard focus can honestly land.
  const closeCard = useCallback(() => {
    const fromList = openedFromList.current;
    openedFromList.current = false;
    close();
    if (fromList) toggleRef.current?.focus();
  }, [close]);

  const deleteAnnotation = useCallback(
    (id: string) => {
      // Deleting the last one unmounts this whole region, so there would be
      // nothing left to focus; anywhere else the pill is where the reader was.
      const remaining = annotations.length > 1;
      remove(id);
      if (remaining) toggleRef.current?.focus();
    },
    [annotations.length, remove],
  );

  function openFromList(annotation: DocumentAnnotation) {
    openedFromList.current = true;
    open(annotation.id);
    const range = ranges.get(annotation.id);
    // An orphaned passage has nowhere to scroll to; the card says so instead.
    if (range) {
      scrollRangeIntoView(range);
      return;
    }
    // Telling a reader their passage "is highlighted as soon as that part of
    // the document loads" is only honest if selecting it actually loads it.
    if (statuses[annotation.id] === "pending") onRequestMore?.();
  }

  if (!ownerId || (annotations.length === 0 && !error)) return null;

  return (
    <aside
      aria-label="Your private annotations in this document"
      className="fixed bottom-6 left-4 z-30 flex w-[min(22rem,calc(100vw-2rem))] flex-col items-start gap-2 sm:left-6"
    >
      {active ? (
        <AnnotationCard
          key={active.id}
          annotation={active}
          status={statuses[active.id] ?? "pending"}
          onClose={closeCard}
          onChanged={replace}
          onDeleted={deleteAnnotation}
        />
      ) : (
        listOpen && (
          <div
            id={listId}
            className="thin-scroll max-h-[60vh] w-full overflow-y-auto rounded-2xl border border-border bg-surface p-3 shadow-lg"
          >
            <p className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-2">
              Private · only you can see this
            </p>
            {!highlightsPainted && (
              <p className="mb-2 rounded-lg border border-dashed border-border-strong px-2 py-1.5 text-[11px] text-muted">
                This browser cannot tint passages in place, so your annotations
                are listed here instead.
              </p>
            )}
            <ul className="flex flex-col gap-0.5">
              {annotations.map((annotation) => {
                const status = statuses[annotation.id] ?? "pending";
                const badge = STATUS_BADGE[status];
                return (
                  <li key={annotation.id}>
                    <button
                      type="button"
                      onClick={() => openFromList(annotation)}
                      className="flex w-full flex-col gap-1 rounded-xl px-2 py-2 text-left hover:bg-surface-2 focus-visible:bg-surface-2"
                    >
                      <span className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-foreground">
                        <LabelSwatch labelId={annotation.label} />
                        {resolveAnnotationLabel(annotation.label).name}
                        {badge && (
                          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-muted-2">
                            {badge}
                          </span>
                        )}
                      </span>
                      <span className="line-clamp-2 font-serif text-xs text-muted">
                        “{annotation.exactText}”
                      </span>
                      <span className="text-[11px] text-muted-2">
                        {annotation.note ? "Private note" : "No note"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )
      )}

      {error && (
        <p
          role="alert"
          className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-xs text-accent shadow-md"
        >
          {error}
        </p>
      )}

      {annotations.length > 0 && (
        <button
          ref={toggleRef}
          type="button"
          aria-expanded={listOpen && !active}
          // The list is only in the DOM while open, and a dangling IDREF is an
          // invalid relationship rather than a harmless one.
          aria-controls={listOpen && !active ? listId : undefined}
          onClick={() => {
            if (active) closeCard();
            setListOpen((current) => (active ? true : !current));
          }}
          className="rounded-full border border-border bg-surface/95 px-3.5 py-2 text-xs font-medium text-muted shadow-md backdrop-blur transition-colors hover:border-accent hover:text-foreground"
        >
          {annotations.length === 1
            ? "1 private annotation"
            : `${annotations.length} private annotations`}
        </button>
      )}
    </aside>
  );
}

function AnnotationCard({
  annotation,
  status,
  onClose,
  onChanged,
  onDeleted,
}: {
  annotation: DocumentAnnotation;
  status: AnnotationStatus;
  onClose: () => void;
  onChanged: (annotation: DocumentAnnotation) => void;
  onDeleted: (id: string) => void;
}) {
  const [noteDraft, setNoteDraft] = useState(annotation.note ?? "");
  const [editingNote, setEditingNote] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cardRef = useRef<HTMLElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const noteId = useId();
  const label = resolveAnnotationLabel(annotation.label);
  const explanation = STATUS_EXPLANATION[status];

  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
    return () => controllerRef.current?.abort();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function send(
    body: { note: string | null } | { label: string },
    onSuccess: () => void,
  ) {
    if (busy) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    // The label buttons sit in a fieldset that disables while the request is in
    // flight, and disabling the focused button drops focus to the document body
    // — restarting a keyboard user at the top of the judgment on every relabel.
    const focused = document.activeElement as HTMLElement | null;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/annotations/${encodeURIComponent(annotation.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          cache: "no-store",
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new Error("Could not save your change.");
      const data = (await response.json()) as {
        annotation: DocumentAnnotation;
      };
      if (controller.signal.aborted) return;
      onChanged(data.annotation);
      onSuccess();
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not save your change.",
      );
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false);
        if (document.activeElement === document.body && focused?.isConnected)
          focused.focus();
      }
    }
  }

  async function deleteAnnotation() {
    if (busy) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/annotations/${encodeURIComponent(annotation.id)}`,
        { method: "DELETE", cache: "no-store", signal: controller.signal },
      );
      if (!response.ok) throw new Error("Could not delete this annotation.");
      if (controller.signal.aborted) return;
      onDeleted(annotation.id);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not delete this annotation.",
      );
      setBusy(false);
    }
  }

  return (
    <section
      ref={cardRef}
      tabIndex={-1}
      aria-label={`Private annotation · ${label.name}`}
      className="w-full rounded-2xl border border-border bg-surface p-4 shadow-lg outline-none"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <LabelSwatch labelId={annotation.label} />
          {label.name}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full px-2.5 py-1 text-xs font-medium text-muted hover:bg-surface-2 hover:text-foreground"
        >
          Close
        </button>
      </div>
      <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-2">
        Private · only you can see this
      </p>

      {explanation && (
        <p className="mt-3 rounded-lg border border-dashed border-border-strong px-2.5 py-2 text-[11px] text-muted">
          {explanation}
        </p>
      )}

      <blockquote className="thin-scroll mt-3 max-h-32 overflow-y-auto border-l-2 border-border-strong pl-3 font-serif text-sm text-foreground/90">
        “{annotation.exactText}”
      </blockquote>

      {editingNote ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send({ note: noteDraft.trim() || null }, () =>
              setEditingNote(false),
            );
          }}
          className="mt-3"
        >
          <label
            htmlFor={noteId}
            className="text-[11px] font-semibold uppercase tracking-wide text-muted-2"
          >
            Private note
          </label>
          <textarea
            id={noteId}
            value={noteDraft}
            onChange={(event) => setNoteDraft(event.target.value)}
            maxLength={MAX_NOTE_LENGTH}
            rows={4}
            placeholder="Why does this passage matter?"
            className="mt-1 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setNoteDraft(annotation.note ?? "");
                setEditingNote(false);
              }}
              className="rounded-full px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-2"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-primary-fg disabled:opacity-60"
            >
              {busy ? "Saving…" : "Save note"}
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-3 rounded-lg border-l-2 border-accent/50 bg-background px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">
            Your private note
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-muted">
            {annotation.note || "No note added."}
          </p>
          <button
            type="button"
            onClick={() => setEditingNote(true)}
            className="mt-2 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted hover:border-accent hover:text-accent"
          >
            {annotation.note ? "Edit note" : "Add note"}
          </button>
        </div>
      )}

      <fieldset className="mt-4" disabled={busy}>
        <legend className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">
          Label
        </legend>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {ANNOTATION_LABELS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={option.id === annotation.label}
              title={option.hint}
              onClick={() => void send({ label: option.id }, () => {})}
              className={
                option.id === annotation.label
                  ? "inline-flex items-center gap-1.5 rounded-full border border-accent bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-foreground"
                  : "inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted hover:border-accent hover:text-foreground disabled:opacity-60"
              }
            >
              <LabelSwatch labelId={option.id} />
              {option.name}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-3">
        {confirmingDelete ? (
          <>
            <span className="mr-auto text-[11px] text-muted">
              Delete this annotation and its note?
            </span>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="rounded-full px-3 py-1 text-xs font-medium text-muted hover:bg-surface-2"
            >
              Keep
            </button>
            <button
              type="button"
              onClick={() => void deleteAnnotation()}
              disabled={busy}
              className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted hover:border-red-300 hover:text-red-700 disabled:opacity-60"
            >
              {busy ? "Deleting…" : "Delete"}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted hover:border-red-300 hover:text-red-700"
          >
            Delete
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs text-accent">
          {error}
        </p>
      )}
    </section>
  );
}

/** Colour never stands alone: every swatch is rendered beside its label name. */
function LabelSwatch({ labelId }: { labelId: string }) {
  const token = annotationLabelToken(labelId);
  return (
    <span
      aria-hidden="true"
      className="h-2.5 w-2.5 shrink-0 rounded-full border"
      style={{
        backgroundColor: `var(--annotation-${token})`,
        borderColor: `var(--annotation-${token}-ink)`,
      }}
    />
  );
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
