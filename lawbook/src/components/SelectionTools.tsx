"use client";

import { useEffect, useRef, useState } from "react";
import {
  PRIVATE_ANNOTATION_LABELS,
  type PrivateAnnotationLabelKey,
} from "@/lib/annotation-labels";
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
  const isSignedIn = Boolean(session?.user);
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null);
  const [draft, setDraft] = useState<SelectionDraft | null>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

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
      setError(null);
      setRect({ top: box.top - 10, left: box.left + box.width / 2 });
    }
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, []);

  if (!rect || !draft) return null;
  const deepPath = `${path}#${encodeURIComponent(draft.sectionAnchor)}`;
  const link = `${window.location.origin}${deepPath}`;
  const formatted = `“${draft.exactText}”\n\n— ${title}${citation ? `, ${citation}` : ""}\n${link}`;

  async function copyQuote() {
    await navigator.clipboard.writeText(formatted);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  async function saveQuote() {
    if (!draft || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draft,
          docType: askKind,
          docId: citation,
          sourceTitle: title,
          citation,
          path: deepPath,
        }),
      });
      if (!res.ok) {
        setError("Could not save quote.");
        return;
      }
      setSaved(true);
    } catch {
      setError("Could not save quote.");
    } finally {
      setSaving(false);
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
        {isSignedIn ? (
          <button
            type="button"
            onClick={() => void saveQuote()}
            disabled={saved || saving}
            className="rounded-full px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-60"
          >
            {saved ? "Saved" : saving ? "Saving…" : "Save quote"}
          </button>
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
        )}
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
