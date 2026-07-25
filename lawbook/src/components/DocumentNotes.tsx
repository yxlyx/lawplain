"use client";

import { useId, useState } from "react";
import {
  MAX_DOCUMENT_NOTE_LENGTH,
  type NoteSaveState,
  useDocumentNote,
} from "@/hooks/useDocumentNote";
import {
  FREE_FORM_TEMPLATE_ID,
  templatesForDocType,
} from "@/lib/document-note-templates";
import type { SavedDocType } from "@/lib/saved-workspace";

function statusText(state: NoteSaveState): string | null {
  switch (state.kind) {
    case "saving":
      return "Saving…";
    case "unsaved":
      return "Unsaved changes";
    case "saved":
      return "Saved";
    case "error":
      return state.message;
    default:
      return null;
  }
}

/**
 * My notes — the reader's private scratchpad for a whole judgment or statute
 * (#194), deliberately distinct from passage annotations: this note belongs to
 * the document rather than to any selected text, and the heading and helper text
 * both say so. Templates are optional scaffolding, so choosing one only adds the
 * headings the note is missing.
 */
export function DocumentNotes({
  docType,
  docId,
  title,
  citation,
  path,
}: {
  docType: SavedDocType;
  docId: string;
  title: string;
  citation: string;
  path: string;
}) {
  const {
    ownerId,
    note,
    draft,
    template,
    state,
    isLoading,
    loadError,
    hasUnsaved,
    edit,
    chooseTemplate,
    saveNow,
    remove,
  } = useDocumentNote({ docType, docId, title, citation, path });
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const editorId = useId();
  const headingId = useId();
  const statusId = useId();
  const templates = templatesForDocType(docType);
  const status = statusText(state);

  // Nothing private renders for a signed-out reader, and the panel never hints
  // that a note exists.
  if (!ownerId) return null;

  return (
    <section
      aria-labelledby={headingId}
      className="mt-8 rounded-2xl border border-border bg-surface p-4 shadow-sm"
    >
      <h2 id={headingId} className="text-sm font-medium text-foreground">
        My notes on this {docType === "statute" ? "statute" : "judgment"}
      </h2>
      <p className="mt-0.5 text-[11px] text-muted-2">
        Private to you. Separate from your highlighted passages — this note
        covers the whole document.
      </p>

      {loadError ? (
        <p role="alert" className="mt-3 text-xs text-accent">
          {loadError}
        </p>
      ) : null}

      {templates.length > 1 ? (
        <fieldset className="mt-4" disabled={isLoading}>
          <legend className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">
            Template
          </legend>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {templates.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={template === option.id}
                onClick={() => chooseTemplate(option.id)}
                className={
                  template === option.id
                    ? "rounded-full border border-accent bg-accent/10 px-3 py-1 text-xs font-medium text-foreground"
                    : "rounded-full border border-border px-3 py-1 text-xs font-medium text-muted hover:border-accent hover:text-foreground"
                }
              >
                {option.name}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-muted-2">
            A template only adds headings you do not already have. Nothing you
            have written is removed.
          </p>
        </fieldset>
      ) : null}

      <label
        htmlFor={editorId}
        className="mt-4 block text-[11px] font-semibold uppercase tracking-wide text-muted-2"
      >
        {template === FREE_FORM_TEMPLATE_ID
          ? "Your notes"
          : "Your notes, under the template headings"}
      </label>
      <textarea
        id={editorId}
        value={draft}
        disabled={isLoading}
        maxLength={MAX_DOCUMENT_NOTE_LENGTH}
        rows={10}
        aria-describedby={status ? statusId : undefined}
        placeholder={
          isLoading ? "Loading your note…" : "Start writing your own notes…"
        }
        onChange={(event) => edit(event.target.value)}
        className="thin-scroll mt-1 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-serif text-sm text-foreground outline-none focus:border-accent"
      />

      <div className="mt-3 flex items-center justify-end gap-2 border-t border-border pt-3">
        <output
          id={statusId}
          aria-live="polite"
          className="mr-auto text-[11px] text-muted"
        >
          {status}
        </output>
        <button
          type="button"
          disabled={!hasUnsaved || !draft.trim()}
          onClick={() => void saveNow()}
          className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-primary-fg disabled:opacity-60"
        >
          Save now
        </button>
        {note ? (
          confirmingDelete ? (
            <>
              <button
                type="button"
                onClick={async () => {
                  await remove();
                  setConfirmingDelete(false);
                }}
                className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted hover:border-red-300 hover:text-red-700"
              >
                Delete permanently
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="rounded-full px-3 py-1 text-xs font-medium text-muted hover:bg-surface-2"
              >
                Keep note
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted hover:border-red-300 hover:text-red-700"
            >
              Delete note
            </button>
          )
        ) : null}
      </div>
      {confirmingDelete ? (
        <p role="alert" className="mt-2 text-xs text-accent">
          Deleting this note cannot be undone. Your highlighted passages are
          kept.
        </p>
      ) : null}
    </section>
  );
}
