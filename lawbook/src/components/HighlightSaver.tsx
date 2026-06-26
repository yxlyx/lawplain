"use client";

import { type PropsWithChildren, useEffect, useRef, useState } from "react";
import { HighlighterIcon } from "@/components/icons";
import { SavedFeatureAuthPrompt } from "@/components/SavedFeatureAuthPrompt";
import { authClient } from "@/lib/auth-client";
import type { SavedDocType } from "@/lib/saved-workspace";

export function HighlightSaver({
  docType,
  docId,
  title,
  path,
  className,
  children,
}: PropsWithChildren<{
  docType: SavedDocType;
  docId: string;
  title: string;
  path: string;
  className?: string;
}>) {
  const { data: session } = authClient.useSession();
  const ref = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{
    text: string;
    sectionId?: string;
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);

  useEffect(() => {
    const update = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim().slice(0, 4000) ?? "";
      if (
        !sel ||
        sel.rangeCount === 0 ||
        text.length < 3 ||
        !ref.current?.contains(sel.getRangeAt(0).commonAncestorContainer)
      ) {
        setSelection(null);
        return;
      }
      let node: Node | null = sel.getRangeAt(0).commonAncestorContainer;
      if (node.nodeType !== Node.ELEMENT_NODE) node = node.parentElement;
      let sectionId: string | undefined;
      while (node && node !== ref.current) {
        if (node instanceof HTMLElement && node.id) {
          sectionId = node.id;
          break;
        }
        node = node.parentElement;
      }
      setSelection({ text, sectionId });
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, []);

  const save = async () => {
    if (!selection) return;
    const fullPath = `${path}${selection.sectionId ? `#${selection.sectionId}` : ""}`;
    const res = await fetch("/api/highlights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        docType,
        docId,
        title,
        path: fullPath,
        sectionId: selection.sectionId,
        selectedText: selection.text,
      }),
    });
    if (res.status === 401) {
      setAuthRequired(true);
      setMessage(null);
    } else {
      setMessage(res.ok ? "Highlight saved." : "Could not save highlight.");
    }
    window.getSelection()?.removeAllRanges();
    setSelection(null);
    window.setTimeout(() => setMessage(null), 2200);
  };

  return (
    <div ref={ref} className={className}>
      {children}
      {(selection || message || authRequired) && (
        <div className="sticky bottom-4 z-20 mt-4 flex justify-center">
          <div className="relative flex items-center gap-2 rounded-full border border-border bg-surface/95 px-3 py-2 text-sm text-muted shadow-lg">
            <HighlighterIcon className="h-4 w-4 text-accent" />
            {selection &&
              (session?.user ? (
                <button
                  type="button"
                  onClick={save}
                  className="font-medium text-accent hover:text-foreground"
                >
                  Save selected text
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setAuthRequired(true)}
                  className="font-medium text-accent hover:text-foreground"
                >
                  Sign in or create account to save selected text
                </button>
              ))}
            {message && <span>{message}</span>}
            {authRequired && (
              <div className="absolute bottom-full mb-2 w-80 max-w-[calc(100vw-2rem)]">
                <SavedFeatureAuthPrompt
                  next={path}
                  compact
                  title="Sign in to save highlights"
                  body="Sign in or create an account to save selected text to your research workspace."
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
