"use client";

import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { ANNOTATIONS_CHANGED_EVENT } from "@/hooks/useDocumentAnnotations";
import {
  ANNOTATION_LABELS,
  annotationLabelToken,
  DEFAULT_ANNOTATION_LABEL_ID,
  resolveAnnotationLabel,
} from "@/lib/annotation-labels";
import { authClient } from "@/lib/auth-client";

const MAX_QUOTE_LENGTH = 5_000;
const MAX_NOTE_LENGTH = 10_000;
/** Widest panel the bar can open (`w-80`), and the gutter it keeps from the edge. */
const PANEL_WIDTH = 320;
const VIEWPORT_MARGIN = 12;
/** Gap between the bar and a panel opening beneath it (`top-[calc(100%+0.5rem)]`). */
const PANEL_GAP = 8;
/** Below this a scrollable panel is worse than none, so it is allowed to spill. */
const PANEL_MIN_HEIGHT = 160;

type SelectionDraft = {
  exactText: string;
  anchor: string;
  sectionAnchor: string;
  startOffset: number;
  endOffset: number;
  contextBefore: string;
  contextAfter: string;
};

function labelSwatchStyle(id: string) {
  const token = annotationLabelToken(id);
  return {
    backgroundColor: `var(--annotation-${token})`,
    borderColor: `var(--annotation-${token}-ink)`,
  };
}

/**
 * The bar is centred on the selection in viewport coordinates, so a passage near
 * either edge would open its palette half off-screen — worst on a phone, where a
 * panel is nearly as wide as the viewport and cannot be scrolled back into view.
 */
function clampToViewport(center: number) {
  const viewport = window.innerWidth;
  const half =
    Math.min(PANEL_WIDTH, Math.max(0, viewport - VIEWPORT_MARGIN * 2)) / 2;
  const min = VIEWPORT_MARGIN + half;
  const max = viewport - VIEWPORT_MARGIN - half;
  return min > max ? viewport / 2 : Math.min(Math.max(center, min), max);
}

/**
 * Panels open downward from a bar fixed to the selection, so a passage low in
 * the viewport would push the last labels below the fold — unreachable, because
 * scrolling moves the page and not the fixed bar. Cap the panel to the space
 * that actually exists and let it scroll instead.
 */
function panelHeightBelow(barTop: number) {
  return Math.max(
    PANEL_MIN_HEIGHT,
    window.innerHeight - barTop - PANEL_GAP - VIEWPORT_MARGIN,
  );
}

/** Arrow-key movement between the controls of a toolbar or palette. */
function focusSibling(container: HTMLElement, step: number) {
  const items = Array.from(
    container.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]"),
  );
  const current = items.indexOf(document.activeElement as HTMLElement);
  if (current === -1) return false;
  items[(current + step + items.length) % items.length]?.focus();
  return true;
}

export function SelectionTools({
  title,
  citation,
  docId,
  path,
  askKind,
}: {
  title: string;
  citation: string;
  docId: string;
  path: string;
  askKind?: "judgment" | "statute";
}) {
  const { data: session } = authClient.useSession();
  const ownerId = session?.user.id ?? null;
  const isSignedIn = Boolean(ownerId);
  const canAnnotate = Boolean(askKind) && isSignedIn;
  const [rect, setRect] = useState<{
    top: number;
    left: number;
    maxPanelHeight: number;
  } | null>(null);
  const [draft, setDraft] = useState<SelectionDraft | null>(null);
  const [draftOwnerId, setDraftOwnerId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedLabelId, setSavedLabelId] = useState(DEFAULT_ANNOTATION_LABEL_ID);
  const [saving, setSaving] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [noteLabelId, setNoteLabelId] = useState(DEFAULT_ANNOTATION_LABEL_ID);
  const [error, setError] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLButtonElement>(null);
  const noteButtonRef = useRef<HTMLButtonElement>(null);
  const firstSwatchRef = useRef<HTMLButtonElement>(null);
  const noteFieldRef = useRef<HTMLTextAreaElement>(null);
  const selectionVersion = useRef(0);
  const ownerIdRef = useRef(ownerId);
  const previousOwnerId = useRef(ownerId);
  ownerIdRef.current = ownerId;

  useEffect(() => {
    function update() {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        setRect(null);
        return;
      }
      const range = selection.getRangeAt(0);
      const start =
        range.startContainer.nodeType === 1
          ? (range.startContainer as Element)
          : range.startContainer.parentElement;
      const end =
        range.endContainer.nodeType === 1
          ? (range.endContainer as Element)
          : range.endContainer.parentElement;
      if (barRef.current?.contains(start)) return;
      const selectable = start?.closest("[data-selectable]");
      const startBlock = start?.closest<HTMLElement>("[data-section-id]");
      const endBlock = end?.closest<HTMLElement>("[data-section-id]");
      if (!selectable || !startBlock || !selectable.contains(startBlock)) {
        setRect(null);
        return;
      }

      // Offsets and the anchor are relative to the block the selection starts in,
      // so a selection may not run past it. Rather than refuse one that does,
      // clamp it to that block: a triple-click selects a paragraph plus one
      // boundary character, which lands endContainer in the *next* paragraph and
      // used to silently offer nothing at all for the commonest way a reader
      // picks out a passage.
      const effective = range.cloneRange();
      if (endBlock !== startBlock) {
        effective.setEnd(startBlock, startBlock.childNodes.length);
      }
      const exactText = effective.toString();
      if (exactText.trim().length < 2 || exactText.length > MAX_QUOTE_LENGTH) {
        setRect(null);
        return;
      }
      const beforeRange = document.createRange();
      beforeRange.selectNodeContents(startBlock);
      beforeRange.setEnd(effective.startContainer, effective.startOffset);
      const startOffset = beforeRange.toString().length;
      const endOffset = startOffset + exactText.length;
      const sourceText = startBlock.textContent ?? "";
      const sectionAnchor = startBlock.dataset.sectionId || startBlock.id;
      const anchor = startBlock.dataset.quoteAnchor || sectionAnchor;
      const box = effective.getBoundingClientRect();
      selectionVersion.current += 1;
      setSaving(false);
      setDraftOwnerId(ownerIdRef.current);
      setDraft({
        exactText,
        anchor,
        sectionAnchor,
        startOffset,
        endOffset,
        contextBefore: sourceText.slice(
          Math.max(0, startOffset - 300),
          startOffset,
        ),
        contextAfter: sourceText.slice(endOffset, endOffset + 300),
      });
      setSaved(false);
      setSavedLabelId(DEFAULT_ANNOTATION_LABEL_ID);
      setPaletteOpen(false);
      setNoteOpen(false);
      setNote("");
      setNoteLabelId(DEFAULT_ANNOTATION_LABEL_ID);
      setError(null);
      setRect({
        top: box.top - 10,
        left: clampToViewport(box.left + box.width / 2),
        maxPanelHeight: panelHeightBelow(box.top - 10),
      });
    }
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, []);

  useEffect(() => {
    if (previousOwnerId.current === ownerId) return;
    previousOwnerId.current = ownerId;
    selectionVersion.current += 1;
    setRect(null);
    setDraft(null);
    setDraftOwnerId(null);
    setSaved(false);
    setSavedLabelId(DEFAULT_ANNOTATION_LABEL_ID);
    setSaving(false);
    setPaletteOpen(false);
    setNoteOpen(false);
    setNote("");
    setNoteLabelId(DEFAULT_ANNOTATION_LABEL_ID);
    setError(null);
  }, [ownerId]);

  useEffect(() => {
    if (paletteOpen) firstSwatchRef.current?.focus();
  }, [paletteOpen]);

  useEffect(() => {
    if (noteOpen) noteFieldRef.current?.focus();
  }, [noteOpen]);

  if (!rect || !draft || draftOwnerId !== ownerId) return null;
  const deepPath = `${path}#${encodeURIComponent(draft.sectionAnchor)}`;
  const link = `${window.location.origin}${deepPath}`;
  const formatted = `“${draft.exactText}”\n\n— ${title}${citation ? `, ${citation}` : ""}\n${link}`;

  async function copyQuote() {
    await navigator.clipboard.writeText(formatted);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  async function saveAnnotation(privateNote: string | null, labelId: string) {
    if (!draft || !askKind || saving || saved) return;
    const requestVersion = selectionVersion.current;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/annotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draft,
          docType: askKind,
          docId,
          title,
          citation,
          path: deepPath,
          note: privateNote,
          label: labelId,
        }),
      });
      if (requestVersion !== selectionVersion.current) return;
      if (!res.ok) {
        // The two statuses the reader can act on deserve their own recovery;
        // collapsing them leaves a signed-out session clicking a dead swatch.
        setError(
          res.status === 401
            ? "Your session expired. Sign in again to save this passage."
            : res.status === 409
              ? "This passage moved. Select it again to highlight it."
              : "Could not save annotation.",
        );
        // Disabling a focused swatch drops focus to the document body, and the
        // error message would then be several tab stops away from the reader.
        toolbarRef.current?.focus();
        return;
      }
      setSavedLabelId(labelId);
      setSaved(true);
      setPaletteOpen(false);
      setNoteOpen(false);
      // The clicked control is about to unmount or turn disabled, so park focus
      // on the bar rather than letting it fall back to the document body.
      toolbarRef.current?.focus();
      // The in-document layer cannot see this component's state, so tell it to
      // reload; otherwise the passage stays untinted until a full reload.
      window.dispatchEvent(new Event(ANNOTATIONS_CHANGED_EVENT));
    } catch {
      if (requestVersion === selectionVersion.current) {
        setError("Could not save annotation.");
        toolbarRef.current?.focus();
      }
    } finally {
      if (requestVersion === selectionVersion.current) setSaving(false);
    }
  }

  function togglePalette() {
    setError(null);
    setNoteOpen(false);
    setPaletteOpen((open) => !open);
  }

  function toggleNoteEditor() {
    setError(null);
    setPaletteOpen(false);
    setNoteOpen((open) => !open);
  }

  function closePalette() {
    setPaletteOpen(false);
    highlightRef.current?.focus();
  }

  function closeNoteEditor() {
    setNoteOpen(false);
    noteButtonRef.current?.focus();
  }

  function onToolbarKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step && focusSibling(event.currentTarget, step)) event.preventDefault();
  }

  function onPaletteKeyDown(event: KeyboardEvent<HTMLFieldSetElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      closePalette();
      return;
    }
    const step =
      event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (step && focusSibling(event.currentTarget, step)) event.preventDefault();
  }

  function onNoteKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    closeNoteEditor();
  }

  function askAboutSelection() {
    const userId = session?.user?.id;
    if (!userId || !askKind || !draft) return;
    const prompt =
      `Explain this passage in context:\n\n“${draft.exactText}”`.slice(
        0,
        5_500,
      );
    // Both the pin and the draft key use docId — the canonical id /api/ask
    // resolves a document by. `citation` is the display form (a judgment's
    // neutral citation, "[2020] SGCA 119"), which the server cannot look up: it
    // answered "Pinned judgment could not be loaded" and the agent never
    // started. It also never matched the key Ask reads back, which is built from
    // the server-resolved citation, so the drafted prompt was silently dropped.
    try {
      sessionStorage.setItem(
        `ask:v2:${userId}:draft:${askKind}:${docId}`,
        prompt,
      );
    } catch {
      // Ask remains usable if storage is unavailable.
    }
    window.location.assign(
      `/ask?cite=${encodeURIComponent(docId)}&kind=${askKind}`,
    );
  }

  return (
    <div
      ref={barRef}
      className="motion-fade-up fixed z-40 -translate-x-1/2 -translate-y-full"
      style={{ top: rect.top, left: rect.left }}
    >
      <div
        ref={toolbarRef}
        role="toolbar"
        aria-label="Selected passage actions"
        tabIndex={-1}
        onKeyDown={onToolbarKeyDown}
        className="flex items-center gap-0.5 rounded-full border border-border bg-surface p-1 shadow-lg"
      >
        {askKind &&
          (isSignedIn ? (
            <>
              <button
                ref={highlightRef}
                type="button"
                onClick={togglePalette}
                disabled={saved || saving}
                aria-expanded={paletteOpen}
                className="rounded-full px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-60"
              >
                {saved ? "Saved" : saving ? "Saving…" : "Highlight"}
              </button>
              <button
                ref={noteButtonRef}
                type="button"
                onClick={toggleNoteEditor}
                disabled={saved || saving}
                aria-expanded={noteOpen}
                className="rounded-full px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-60"
              >
                Add note
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2 px-2 py-1 text-xs">
              <span className="text-muted">Save with an account</span>
              <a
                href={`/sign-in?next=${encodeURIComponent(path)}`}
                className="font-medium text-accent hover:underline"
              >
                Sign in
              </a>
              <a
                href={`/sign-up?next=${encodeURIComponent(path)}`}
                className="font-medium text-accent hover:underline"
              >
                Create account
              </a>
            </div>
          ))}
        <button
          type="button"
          onClick={() => void copyQuote()}
          className="rounded-full px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-2 hover:text-foreground"
          aria-label="Copy quote with citation and link"
        >
          {copied ? "Copied" : "Copy"}
        </button>
        {isSignedIn && askKind && (
          <button
            type="button"
            onClick={askAboutSelection}
            className="rounded-full px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-2 hover:text-foreground"
          >
            Ask
          </button>
        )}
      </div>
      {canAnnotate && (
        <>
          {paletteOpen && (
            <fieldset
              aria-labelledby="selection-label-palette-title"
              onKeyDown={onPaletteKeyDown}
              style={{ maxHeight: rect.maxPanelHeight }}
              className="thin-scroll absolute left-1/2 top-[calc(100%+0.5rem)] w-80 min-w-0 max-w-[calc(100vw-1.5rem)] -translate-x-1/2 overflow-y-auto rounded-xl border border-border bg-surface p-1.5 shadow-lg"
            >
              <p
                id="selection-label-palette-title"
                className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-2"
              >
                Highlight as
              </p>
              {ANNOTATION_LABELS.map((label, index) => (
                <button
                  key={label.id}
                  ref={index === 0 ? firstSwatchRef : undefined}
                  type="button"
                  onClick={() => void saveAnnotation(null, label.id)}
                  disabled={saved || saving}
                  aria-label={`Highlight as ${label.name}`}
                  className="flex w-full items-center gap-2.5 rounded-full px-2 py-1.5 text-left hover:bg-surface-2 disabled:opacity-60"
                >
                  <span
                    aria-hidden="true"
                    className="h-3.5 w-3.5 shrink-0 rounded-full border"
                    style={labelSwatchStyle(label.id)}
                  />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-foreground">
                      {label.name}
                    </span>
                    <span className="block truncate text-[11px] text-muted-2">
                      {label.hint}
                    </span>
                  </span>
                </button>
              ))}
            </fieldset>
          )}
          {noteOpen && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void saveAnnotation(note, noteLabelId);
              }}
              onKeyDown={onNoteKeyDown}
              style={{ maxHeight: rect.maxPanelHeight }}
              className="thin-scroll absolute left-1/2 top-[calc(100%+0.5rem)] w-80 max-w-[calc(100vw-1.5rem)] -translate-x-1/2 overflow-y-auto rounded-xl border border-border bg-surface p-3 shadow-lg"
            >
              <label
                htmlFor="selection-private-note"
                className="block text-xs font-semibold text-foreground"
              >
                Private note
              </label>
              <textarea
                ref={noteFieldRef}
                id="selection-private-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={MAX_NOTE_LENGTH}
                rows={4}
                placeholder="Why does this passage matter?"
                className="mt-2 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
              />
              <p
                id="selection-note-label-title"
                className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-2"
              >
                Label
              </p>
              <fieldset
                aria-labelledby="selection-note-label-title"
                className="mt-1.5 flex min-w-0 flex-wrap gap-1"
              >
                {ANNOTATION_LABELS.map((label) => {
                  const chosen = label.id === noteLabelId;
                  return (
                    <button
                      key={label.id}
                      type="button"
                      onClick={() => setNoteLabelId(label.id)}
                      aria-pressed={chosen}
                      className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium ${
                        chosen
                          ? "border-border-strong bg-surface-2 text-foreground"
                          : "border-border text-muted hover:bg-surface-2 hover:text-foreground"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className="h-2.5 w-2.5 shrink-0 rounded-full border"
                        style={labelSwatchStyle(label.id)}
                      />
                      {label.name}
                    </button>
                  );
                })}
              </fieldset>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-2">
                  Only visible to you
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={closeNoteEditor}
                    className="rounded-full px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-2"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-primary-fg disabled:opacity-60"
                  >
                    {saving ? "Saving…" : "Save annotation"}
                  </button>
                </div>
              </div>
            </form>
          )}
          {saved && (
            <output className="mt-1 block rounded bg-surface px-2 py-1 text-xs text-muted shadow">
              Saved as {resolveAnnotationLabel(savedLabelId).name}
            </output>
          )}
          {error && (
            <p
              role="alert"
              className="mt-1 rounded bg-surface px-2 py-1 text-xs text-accent shadow"
            >
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
