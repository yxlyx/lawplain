"use client";

import { useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";

const MAX_QUOTE_LENGTH = 5_000;
const MAX_NOTE_LENGTH = 10_000;

type SelectionDraft = {
  exactText: string;
  anchor: string;
  sectionAnchor: string;
  startOffset: number;
  endOffset: number;
  contextBefore: string;
  contextAfter: string;
};

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
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null);
  const [draft, setDraft] = useState<SelectionDraft | null>(null);
  const [draftOwnerId, setDraftOwnerId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
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
      const exactText = selection.toString();
      if (
        !selectable ||
        !startBlock ||
        startBlock !== endBlock ||
        !selectable.contains(endBlock) ||
        exactText.trim().length < 2 ||
        exactText.length > MAX_QUOTE_LENGTH
      ) {
        setRect(null);
        return;
      }
      const beforeRange = document.createRange();
      beforeRange.selectNodeContents(startBlock);
      beforeRange.setEnd(range.startContainer, range.startOffset);
      const startOffset = beforeRange.toString().length;
      const endOffset = startOffset + exactText.length;
      const sourceText = startBlock.textContent ?? "";
      const sectionAnchor = startBlock.dataset.sectionId || startBlock.id;
      const anchor = startBlock.dataset.quoteAnchor || sectionAnchor;
      const box = range.getBoundingClientRect();
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
      setNoteOpen(false);
      setNote("");
      setError(null);
      setRect({ top: box.top - 10, left: box.left + box.width / 2 });
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
    setSaving(false);
    setNoteOpen(false);
    setNote("");
    setError(null);
  }, [ownerId]);

  if (!rect || !draft || draftOwnerId !== ownerId) return null;
  const deepPath = `${path}#${encodeURIComponent(draft.sectionAnchor)}`;
  const link = `${window.location.origin}${deepPath}`;
  const formatted = `“${draft.exactText}”\n\n— ${title}${citation ? `, ${citation}` : ""}\n${link}`;

  async function copyQuote() {
    await navigator.clipboard.writeText(formatted);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  async function saveAnnotation(privateNote: string | null) {
    if (!draft || !askKind || saving) return;
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
        }),
      });
      if (requestVersion !== selectionVersion.current) return;
      if (!res.ok) {
        setError("Could not save annotation.");
        return;
      }
      setSaved(true);
      setNoteOpen(false);
    } catch {
      if (requestVersion === selectionVersion.current)
        setError("Could not save annotation.");
    } finally {
      if (requestVersion === selectionVersion.current) setSaving(false);
    }
  }

  function askAboutSelection() {
    const userId = session?.user?.id;
    if (!userId || !askKind || !draft) return;
    const prompt =
      `Explain this passage in context:\n\n“${draft.exactText}”`.slice(
        0,
        5_500,
      );
    try {
      sessionStorage.setItem(
        `ask:v2:${userId}:draft:${askKind}:${citation}`,
        prompt,
      );
    } catch {
      // Ask remains usable if storage is unavailable.
    }
    window.location.assign(
      `/ask?cite=${encodeURIComponent(citation)}&kind=${askKind}`,
    );
  }

  return (
    <div
      ref={barRef}
      className="motion-fade-up fixed z-40 -translate-x-1/2 -translate-y-full"
      style={{ top: rect.top, left: rect.left }}
    >
      <div className="flex items-center gap-0.5 rounded-full border border-border bg-surface p-1 shadow-lg">
        {askKind &&
          (isSignedIn ? (
            <>
              <button
                type="button"
                onClick={() => void saveAnnotation(null)}
                disabled={saved || saving}
                className="rounded-full px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-60"
              >
                {saved ? "Saved" : saving ? "Saving…" : "Highlight"}
              </button>
              <button
                type="button"
                onClick={() => setNoteOpen((open) => !open)}
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
      {noteOpen && isSignedIn && askKind && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void saveAnnotation(note);
          }}
          className="absolute left-1/2 top-[calc(100%+0.5rem)] w-80 -translate-x-1/2 rounded-xl border border-border bg-surface p-3 shadow-lg"
        >
          <label
            htmlFor="selection-private-note"
            className="block text-xs font-semibold text-foreground"
          >
            Private note
          </label>
          <textarea
            id="selection-private-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={MAX_NOTE_LENGTH}
            rows={4}
            placeholder="Why does this passage matter?"
            className="mt-2 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-2">
              Only visible to you
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setNoteOpen(false)}
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
      {error && (
        <p
          role="alert"
          className="mt-1 rounded bg-surface px-2 py-1 text-xs text-accent shadow"
        >
          {error}
        </p>
      )}
    </div>
  );
}
