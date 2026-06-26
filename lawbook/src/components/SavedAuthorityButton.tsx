"use client";

import { useEffect, useRef, useState } from "react";
import { BookmarkIcon, CheckIcon } from "@/components/icons";
import { SavedFeatureAuthPrompt } from "@/components/SavedFeatureAuthPrompt";
import { useExclusiveToolbarPopover } from "@/components/useExclusiveToolbarPopover";
import { authClient } from "@/lib/auth-client";
import type { SavedDocType } from "@/lib/saved-workspace";

export function SavedAuthorityButton({
  docType,
  docId,
  title,
  path,
}: {
  docType: SavedDocType;
  docId: string;
  title: string;
  path: string;
}) {
  const { data: session, isPending } = authClient.useSession();
  const userId = session?.user?.id;
  const [isSaved, setIsSaved] = useState(false);
  const [checkingSaved, setCheckingSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const announceToolbarPopoverOpen = useExclusiveToolbarPopover(() => {
    setShowAuthPrompt(false);
  });

  useEffect(() => {
    if (!showAuthPrompt) return;

    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (
        target instanceof Node &&
        rootRef.current &&
        !rootRef.current.contains(target)
      ) {
        setShowAuthPrompt(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setShowAuthPrompt(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [showAuthPrompt]);

  useEffect(() => {
    if (!userId) {
      setIsSaved(false);
      setCheckingSaved(false);
      return;
    }

    const version = requestVersion.current;
    let cancelled = false;

    async function checkSaved() {
      setCheckingSaved(true);
      setMessage(null);
      try {
        const params = new URLSearchParams({ docType, docId });
        const res = await fetch(`/api/saved?${params}`, { cache: "no-store" });

        if (cancelled || version !== requestVersion.current) return;

        if (res.status === 401) {
          announceToolbarPopoverOpen();
          setShowAuthPrompt(true);
          return;
        }

        if (!res.ok) return;

        const payload = (await res.json()) as { saved?: unknown };
        if (!cancelled && version === requestVersion.current) {
          setIsSaved(Boolean(payload.saved));
        }
      } catch {
        // Saved-state lookup is best-effort; the save action still works.
      } finally {
        if (!cancelled && version === requestVersion.current) {
          setCheckingSaved(false);
        }
      }
    }

    void checkSaved();

    return () => {
      cancelled = true;
    };
  }, [userId, docType, docId, announceToolbarPopoverOpen]);

  const savedDisplay = isSaved;
  const className = `inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-60 ${
    savedDisplay
      ? "border-accent bg-accent-soft text-accent"
      : "border-border-strong text-muted hover:border-accent hover:text-foreground"
  }`;

  if (isPending)
    return (
      <button type="button" className={className} disabled>
        <BookmarkIcon className="h-4 w-4" />
        Save
      </button>
    );

  if (!userId)
    return (
      <div ref={rootRef} className="relative inline-flex">
        <button
          type="button"
          onClick={() => {
            if (showAuthPrompt) {
              setShowAuthPrompt(false);
              return;
            }

            announceToolbarPopoverOpen();
            setShowAuthPrompt(true);
          }}
          className={className}
          aria-expanded={showAuthPrompt}
        >
          <BookmarkIcon className="h-4 w-4" />
          Save
        </button>
        {showAuthPrompt && (
          <div className="absolute right-0 top-full z-30 mt-2 w-72">
            <SavedFeatureAuthPrompt
              next={path}
              compact
              title="Sign in to save"
              body="Sign in or create an account to save this document to your research workspace."
            />
          </div>
        )}
      </div>
    );

  const save = async () => {
    if (busy || isSaved) return;
    announceToolbarPopoverOpen();
    const version = ++requestVersion.current;
    setBusy(true);
    setShowAuthPrompt(false);
    setMessage(null);

    try {
      const res = await fetch("/api/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docType, docId, title, path }),
      });

      if (version !== requestVersion.current) return;

      if (res.status === 401) {
        announceToolbarPopoverOpen();
        setShowAuthPrompt(true);
        setMessage("Please sign in again to save this document.");
        return;
      }

      if (!res.ok) {
        setMessage("Could not save. Please try again.");
        return;
      }

      setIsSaved(true);
      setMessage(null);
    } catch {
      if (version !== requestVersion.current) return;
      setMessage("Could not save. Please try again.");
    } finally {
      if (version === requestVersion.current) setBusy(false);
    }
  };

  return (
    <div
      ref={rootRef}
      className="relative inline-flex flex-col items-end gap-1"
    >
      <button
        type="button"
        onClick={save}
        disabled={busy || checkingSaved}
        className={className}
        aria-live="polite"
        aria-pressed={savedDisplay}
      >
        {savedDisplay ? (
          <CheckIcon className="h-4 w-4" />
        ) : (
          <BookmarkIcon className="h-4 w-4" />
        )}
        {savedDisplay
          ? "Saved"
          : busy
            ? "Saving…"
            : checkingSaved
              ? "Checking…"
              : "Save"}
      </button>
      {message && (
        <p className="max-w-64 text-right text-xs text-red-700">{message}</p>
      )}
      {showAuthPrompt && (
        <div className="absolute right-0 top-full z-30 mt-2 w-72">
          <SavedFeatureAuthPrompt
            next={path}
            compact
            title="Sign in again to save"
            body="Your session may have expired. Sign in or create an account to save this document."
          />
        </div>
      )}
    </div>
  );
}
