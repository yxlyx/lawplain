"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import {
  applyTemplate,
  FREE_FORM_TEMPLATE_ID,
} from "@/lib/document-note-templates";
import type { SavedDocType } from "@/lib/saved-workspace";

export const MAX_DOCUMENT_NOTE_LENGTH = 50_000;
const AUTOSAVE_DEBOUNCE_MS = 1_200;

export type NoteSaveState =
  | { kind: "idle" }
  | { kind: "unsaved" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "error"; message: string };

export interface DocumentNote {
  id: string;
  body: string;
  template: string;
  createdAt: number;
  updatedAt: number;
}

interface DocumentIdentity {
  docType: SavedDocType;
  docId: string;
  title: string;
  citation: string;
  path: string;
}

/**
 * The reader's private scratchpad for one whole document.
 *
 * Draft text is the single source of truth while editing, and it is never
 * replaced by a server response mid-edit: a reload that arrived after the reader
 * started typing would silently discard their work. Autosave is debounced, and a
 * manual save always wins over a pending debounce.
 */
export function useDocumentNote(identity: DocumentIdentity) {
  const { data: session } = authClient.useSession();
  const ownerId = session?.user.id ?? null;
  const { docType, docId } = identity;

  const [note, setNote] = useState<DocumentNote | null>(null);
  const [draft, setDraft] = useState("");
  const [template, setTemplate] = useState(FREE_FORM_TEMPLATE_ID);
  const [state, setState] = useState<NoteSaveState>({ kind: "idle" });
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Guards a late GET from overwriting text typed while it was in flight.
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const identityRef = useRef(identity);
  identityRef.current = identity;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Reset and load are one effect: moving to another document must clear the
  // previous document's note before its replacement arrives, so a reader never
  // sees one judgment's notes while another is on screen.
  useEffect(() => {
    dirtyRef.current = false;
    setNote(null);
    setDraft("");
    setTemplate(FREE_FORM_TEMPLATE_ID);
    setState({ kind: "idle" });
    setLoadError(null);
    if (!ownerId) return;
    let cancelled = false;
    setIsLoading(true);
    (async () => {
      try {
        const params = new URLSearchParams({ docType, docId });
        const response = await fetch(`/api/document-notes?${params}`, {
          headers: { accept: "application/json" },
        });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { note: DocumentNote | null };
        if (cancelled || dirtyRef.current) return;
        setNote(body.note);
        setDraft(body.note?.body ?? "");
        setTemplate(body.note?.template ?? FREE_FORM_TEMPLATE_ID);
        setLoadError(null);
      } catch {
        if (!cancelled)
          setLoadError("Your note could not be loaded. Reload to try again.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [docType, docId, ownerId]);

  const persist = useCallback(
    async (body: string, templateId: string) => {
      clearTimer();
      const current = identityRef.current;
      if (!body.trim()) {
        // An empty editor is not a delete. Deleting is an explicit action, so
        // clearing the text can never silently destroy a saved note.
        setState({ kind: "unsaved" });
        return false;
      }
      setState({ kind: "saving" });
      try {
        const response = await fetch("/api/document-notes", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...current, body, template: templateId }),
        });
        if (response.status === 401) {
          setState({
            kind: "error",
            message: "Your session ended. Sign in again to save this note.",
          });
          return false;
        }
        if (response.status === 409) {
          setState({
            kind: "error",
            message:
              "This document's research was deleted elsewhere. Copy your text before reloading.",
          });
          return false;
        }
        if (!response.ok) throw new Error(String(response.status));
        const saved = (await response.json()) as { note: DocumentNote };
        setNote(saved.note);
        dirtyRef.current = false;
        setState({ kind: "saved", at: saved.note.updatedAt });
        return true;
      } catch {
        setState({
          kind: "error",
          message:
            "Your note could not be saved. It is still here — try again.",
        });
        return false;
      }
    },
    [clearTimer],
  );

  const edit = useCallback(
    (next: string) => {
      if (next.length > MAX_DOCUMENT_NOTE_LENGTH) return;
      dirtyRef.current = true;
      setDraft(next);
      setState({ kind: "unsaved" });
      clearTimer();
      const templateId = template;
      timerRef.current = setTimeout(() => {
        void persist(next, templateId);
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [clearTimer, persist, template],
  );

  /**
   * Switching mode only ever adds headings the note is missing; it never
   * rewrites or removes text, so no draft can be lost by changing template.
   */
  const chooseTemplate = useCallback(
    (templateId: string) => {
      setTemplate(templateId);
      const next = applyTemplate(draft, templateId);
      dirtyRef.current = true;
      setDraft(next);
      setState({ kind: "unsaved" });
      clearTimer();
      timerRef.current = setTimeout(() => {
        void persist(next, templateId);
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [clearTimer, draft, persist],
  );

  const saveNow = useCallback(
    () => persist(draft, template),
    [draft, persist, template],
  );

  const remove = useCallback(async () => {
    clearTimer();
    const current = identityRef.current;
    setState({ kind: "saving" });
    try {
      const params = new URLSearchParams({
        docType: current.docType,
        docId: current.docId,
      });
      const response = await fetch(`/api/document-notes?${params}`, {
        method: "DELETE",
      });
      if (!response.ok && response.status !== 404)
        throw new Error(String(response.status));
      setNote(null);
      setDraft("");
      setTemplate(FREE_FORM_TEMPLATE_ID);
      dirtyRef.current = false;
      setState({ kind: "idle" });
      return true;
    } catch {
      setState({
        kind: "error",
        message: "Your note could not be deleted. It is unchanged.",
      });
      return false;
    }
  }, [clearTimer]);

  const hasUnsaved = state.kind === "unsaved" || state.kind === "saving";

  // Leaving with an unsaved draft would lose it, so warn before navigating away.
  useEffect(() => {
    if (!hasUnsaved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsaved]);

  useEffect(() => clearTimer, [clearTimer]);

  return {
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
  };
}
