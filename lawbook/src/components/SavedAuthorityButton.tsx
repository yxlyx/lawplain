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
  const userId = session?.user?.id ?? null;
  const stateKey = userId ? JSON.stringify([userId, docType, docId]) : null;
  const [dataKey, setDataKey] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [checkingSaved, setCheckingSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<"save" | "unsave" | null>(null);
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const [showUnsavedNotice, setShowUnsavedNotice] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const mutationController = useRef<AbortController | null>(null);
  const stateKeyRef = useRef(stateKey);
  stateKeyRef.current = stateKey;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const unsavedNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announceToolbarPopoverOpen = useExclusiveToolbarPopover(() => {
    setShowAuthPrompt(false);
    setShowUnsavedNotice(false);
  });

  function clearUnsavedNotice() {
    if (unsavedNoticeTimer.current) {
      clearTimeout(unsavedNoticeTimer.current);
      unsavedNoticeTimer.current = null;
    }
    setShowUnsavedNotice(false);
  }

  function flashUnsavedNotice() {
    clearUnsavedNotice();
    setShowUnsavedNotice(true);
    unsavedNoticeTimer.current = setTimeout(() => {
      setShowUnsavedNotice(false);
      unsavedNoticeTimer.current = null;
    }, 5000);
  }

  useEffect(() => {
    return () => {
      if (unsavedNoticeTimer.current) clearTimeout(unsavedNoticeTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!showAuthPrompt && !showUnsavedNotice) return;

    function dismissFloatingState() {
      setShowAuthPrompt(false);
      setShowUnsavedNotice(false);
      if (unsavedNoticeTimer.current) {
        clearTimeout(unsavedNoticeTimer.current);
        unsavedNoticeTimer.current = null;
      }
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (
        target instanceof Node &&
        rootRef.current &&
        !rootRef.current.contains(target)
      ) {
        dismissFloatingState();
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") dismissFloatingState();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [showAuthPrompt, showUnsavedNotice]);

  useEffect(() => {
    const version = ++requestVersion.current;
    const controller = new AbortController();
    let cancelled = false;

    mutationController.current?.abort();
    mutationController.current = null;
    setDataKey(stateKey);
    setIsSaved(false);
    setCheckingSaved(Boolean(userId));
    setBusy(false);
    setBusyAction(null);
    setMessage(null);
    setShowAuthPrompt(false);
    if (unsavedNoticeTimer.current) {
      clearTimeout(unsavedNoticeTimer.current);
      unsavedNoticeTimer.current = null;
    }
    setShowUnsavedNotice(false);

    if (!userId) return () => controller.abort();

    async function checkSaved() {
      try {
        const params = new URLSearchParams({ docType, docId });
        const res = await fetch(`/api/saved?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });

        if (
          cancelled ||
          version !== requestVersion.current ||
          stateKeyRef.current !== stateKey
        )
          return;

        if (res.status === 401) {
          announceToolbarPopoverOpen();
          setShowAuthPrompt(true);
          return;
        }

        if (!res.ok) return;

        const payload = (await res.json()) as { saved?: unknown };
        if (
          !cancelled &&
          version === requestVersion.current &&
          stateKeyRef.current === stateKey
        ) {
          setIsSaved(Boolean(payload.saved));
        }
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError")
          return;
        // Saved-state lookup is best-effort; the save action still works.
      } finally {
        if (
          !cancelled &&
          version === requestVersion.current &&
          stateKeyRef.current === stateKey
        ) {
          setCheckingSaved(false);
        }
      }
    }

    void checkSaved();

    return () => {
      cancelled = true;
      controller.abort();
      mutationController.current?.abort();
    };
  }, [userId, stateKey, docType, docId, announceToolbarPopoverOpen]);

  const stateIsCurrent = dataKey === stateKey;
  const savedDisplay = !isPending && stateIsCurrent && isSaved;
  const checkingDisplay = Boolean(userId) && (!stateIsCurrent || checkingSaved);
  const busyDisplay = stateIsCurrent && busy;
  const unsavedNoticeDisplay = stateIsCurrent && showUnsavedNotice;
  const messageDisplay = stateIsCurrent ? message : null;
  const authPromptDisplay = stateIsCurrent && showAuthPrompt;
  const className = `inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-60 ${
    savedDisplay
      ? "border-accent bg-accent-soft text-accent"
      : unsavedNoticeDisplay
        ? "border-border bg-surface-2 text-muted"
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
    const operationKey = stateKey;
    if (!operationKey || !stateIsCurrent || busy || isSaved) return;
    announceToolbarPopoverOpen();
    clearUnsavedNotice();
    const version = ++requestVersion.current;
    const controller = new AbortController();
    mutationController.current?.abort();
    mutationController.current = controller;
    setBusy(true);
    setBusyAction("save");
    setShowAuthPrompt(false);
    setMessage(null);

    try {
      const res = await fetch("/api/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docType, docId, title, path }),
        signal: controller.signal,
      });

      if (
        version !== requestVersion.current ||
        stateKeyRef.current !== operationKey
      )
        return;

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
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError")
        return;
      if (
        version !== requestVersion.current ||
        stateKeyRef.current !== operationKey
      )
        return;
      setMessage("Could not save. Please try again.");
    } finally {
      if (mutationController.current === controller) {
        mutationController.current = null;
      }
      if (
        version === requestVersion.current &&
        stateKeyRef.current === operationKey
      ) {
        setBusy(false);
        setBusyAction(null);
      }
    }
  };

  const unsave = async () => {
    const operationKey = stateKey;
    if (!operationKey || !stateIsCurrent || busy || !isSaved) return;
    announceToolbarPopoverOpen();
    const version = ++requestVersion.current;
    const controller = new AbortController();
    mutationController.current?.abort();
    mutationController.current = controller;
    setBusy(true);
    setBusyAction("unsave");
    setShowAuthPrompt(false);
    setMessage(null);

    try {
      const params = new URLSearchParams({ docType, docId });
      const res = await fetch(`/api/saved?${params}`, {
        method: "DELETE",
        signal: controller.signal,
      });

      if (
        version !== requestVersion.current ||
        stateKeyRef.current !== operationKey
      )
        return;

      if (res.status === 401) {
        announceToolbarPopoverOpen();
        setShowAuthPrompt(true);
        setMessage("Please sign in again to unsave this document.");
        return;
      }

      if (!res.ok) {
        setMessage("Could not unsave. Please try again.");
        return;
      }

      setIsSaved(false);
      setMessage(null);
      flashUnsavedNotice();
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError")
        return;
      if (
        version !== requestVersion.current ||
        stateKeyRef.current !== operationKey
      )
        return;
      setMessage("Could not unsave. Please try again.");
    } finally {
      if (mutationController.current === controller) {
        mutationController.current = null;
      }
      if (
        version === requestVersion.current &&
        stateKeyRef.current === operationKey
      ) {
        setBusy(false);
        setBusyAction(null);
      }
    }
  };

  return (
    <div
      ref={rootRef}
      className="relative inline-flex flex-col items-end gap-1"
    >
      <button
        type="button"
        onClick={savedDisplay ? unsave : save}
        disabled={busyDisplay || checkingDisplay}
        className={className}
        aria-live="polite"
        aria-pressed={savedDisplay}
      >
        {savedDisplay ? (
          <CheckIcon className="h-4 w-4" />
        ) : (
          <BookmarkIcon className="h-4 w-4" />
        )}
        {busyDisplay
          ? busyAction === "unsave"
            ? "Unsaving…"
            : "Saving…"
          : checkingDisplay
            ? "Checking…"
            : unsavedNoticeDisplay
              ? "Unsaved"
              : savedDisplay
                ? "Saved"
                : "Save"}
      </button>
      {messageDisplay && (
        <p className="max-w-64 text-right text-xs text-red-700">
          {messageDisplay}
        </p>
      )}
      {authPromptDisplay && (
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
