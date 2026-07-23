"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { XIcon } from "@/components/icons";
import { SavedFeatureAuthPrompt } from "@/components/SavedFeatureAuthPrompt";
import { authClient } from "@/lib/auth-client";

type LibraryAuthority = {
  id: string;
  docType: "judgment" | "statute";
  docId: string;
  title: string;
  citation: string;
  path: string;
  savedAt: number | null;
  createdAt: number;
  activityAt: number;
  annotationCount: number;
};

type LibraryPage = {
  authorities: LibraryAuthority[];
  nextCursor: string | null;
};

type UndoToast = {
  item: LibraryAuthority;
  message: string;
};

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(timestamp));
}

function docLabel(docType: LibraryAuthority["docType"]): string {
  return docType === "judgment" ? "Judgment" : "Statute";
}

export function SavedWorkspace() {
  const { data: session, isPending } = authClient.useSession();
  const ownerId = session?.user.id ?? null;
  const [dataOwnerId, setDataOwnerId] = useState<string | null>(null);
  const [authorities, setAuthorities] = useState<LibraryAuthority[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [undoToast, setUndoToast] = useState<UndoToast | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const undoTimer = useRef<number | null>(null);
  const removeInFlight = useRef(false);
  const loadVersion = useRef(0);
  const ownerVersion = useRef(0);
  const paginationController = useRef<AbortController | null>(null);
  const removeController = useRef<AbortController | null>(null);
  const undoController = useRef<AbortController | null>(null);
  const ownerStateIsCurrent = dataOwnerId === ownerId;
  const visibleAuthorities = ownerStateIsCurrent ? authorities : [];
  const visibleNextCursor = ownerStateIsCurrent ? nextCursor : null;
  const visibleUndoToast = ownerStateIsCurrent ? undoToast : null;

  const loadLibrary = useCallback(
    async ({
      cursor,
      append,
      signal,
    }: {
      cursor?: string | null;
      append?: boolean;
      signal?: AbortSignal;
    } = {}) => {
      if (!ownerId) return;
      const requestOwnerVersion = ownerVersion.current;
      const requestVersion = append
        ? loadVersion.current
        : ++loadVersion.current;
      append ? setLoadingMore(true) : setLoading(true);
      setError(null);
      setAuthRequired(false);
      try {
        const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
        const response = await fetch(`/api/library${query}`, {
          cache: "no-store",
          signal,
        });
        if (
          signal?.aborted ||
          requestVersion !== loadVersion.current ||
          requestOwnerVersion !== ownerVersion.current
        )
          return;
        if (response.status === 401) {
          setAuthorities([]);
          setNextCursor(null);
          setAuthRequired(true);
          return;
        }
        if (!response.ok) throw new Error("Could not load saved research.");
        const data = (await response.json()) as LibraryPage;
        setAuthorities((items) =>
          append ? [...items, ...(data.authorities ?? [])] : data.authorities,
        );
        setNextCursor(data.nextCursor ?? null);
      } catch (caught) {
        if (
          requestVersion === loadVersion.current &&
          requestOwnerVersion === ownerVersion.current &&
          !(caught instanceof DOMException && caught.name === "AbortError")
        ) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Could not load saved research.",
          );
        }
      } finally {
        if (
          requestVersion === loadVersion.current &&
          requestOwnerVersion === ownerVersion.current
        ) {
          if (append) setLoadingMore(false);
          else setLoading(false);
        }
      }
    },
    [ownerId],
  );

  useEffect(() => {
    return () => {
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
    };
  }, []);

  useEffect(() => {
    ownerVersion.current += 1;
    loadVersion.current += 1;
    paginationController.current?.abort();
    removeController.current?.abort();
    undoController.current?.abort();
    paginationController.current = null;
    removeController.current = null;
    undoController.current = null;
    removeInFlight.current = false;
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    setDataOwnerId(ownerId);
    setAuthorities([]);
    setNextCursor(null);
    setError(null);
    setLoading(false);
    setLoadingMore(false);
    setAuthRequired(false);
    setUndoToast(null);
    setRemovingId(null);
    if (!ownerId) return;

    const controller = new AbortController();
    void loadLibrary({ signal: controller.signal });
    return () => {
      controller.abort();
      paginationController.current?.abort();
      removeController.current?.abort();
      undoController.current?.abort();
      ownerVersion.current += 1;
      loadVersion.current += 1;
    };
  }, [loadLibrary, ownerId]);

  useEffect(() => {
    function refreshLibrary() {
      void loadLibrary();
    }
    window.addEventListener("lawplain:library-changed", refreshLibrary);
    return () =>
      window.removeEventListener("lawplain:library-changed", refreshLibrary);
  }, [loadLibrary]);

  function showUndoToast(item: LibraryAuthority, version: number) {
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    setUndoToast({
      item,
      message: `${docLabel(item.docType)} unsaved.`,
    });
    undoTimer.current = window.setTimeout(() => {
      if (version === ownerVersion.current) setUndoToast(null);
    }, 5000);
  }

  async function removeAuthority(item: LibraryAuthority) {
    if (!ownerStateIsCurrent || removeInFlight.current) return;
    const version = ownerVersion.current;
    const controller = new AbortController();
    removeController.current?.abort();
    removeController.current = controller;
    removeInFlight.current = true;
    setRemovingId(item.id);
    setError(null);
    setAuthorities((items) =>
      item.annotationCount > 0
        ? items.map((candidate) =>
            candidate.id === item.id
              ? { ...candidate, savedAt: null }
              : candidate,
          )
        : items.filter((candidate) => candidate.id !== item.id),
    );

    try {
      const response = await fetch(
        `/api/saved?docType=${item.docType}&docId=${encodeURIComponent(item.docId)}`,
        { method: "DELETE", signal: controller.signal },
      );
      if (!response.ok) throw new Error("Could not remove saved document.");
      if (controller.signal.aborted || version !== ownerVersion.current) return;
      showUndoToast(item, version);
    } catch (caught) {
      if (controller.signal.aborted || version !== ownerVersion.current) return;
      setAuthorities((items) => [
        item,
        ...items.filter((candidate) => candidate.id !== item.id),
      ]);
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not remove saved document.",
      );
    } finally {
      if (removeController.current === controller)
        removeController.current = null;
      if (version === ownerVersion.current) {
        removeInFlight.current = false;
        setRemovingId(null);
      }
    }
  }

  async function undoRemove() {
    if (!visibleUndoToast || !ownerStateIsCurrent) return;
    const version = ownerVersion.current;
    const controller = new AbortController();
    undoController.current?.abort();
    undoController.current = controller;
    const { item } = visibleUndoToast;
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    setUndoToast(null);
    setError(null);

    try {
      const response = await fetch("/api/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docType: item.docType,
          docId: item.docId,
          title: item.title,
          citation: item.citation,
          path: item.path,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Could not restore saved document.");
      const data = (await response.json()) as {
        saved?: Partial<LibraryAuthority>;
      };
      if (controller.signal.aborted || version !== ownerVersion.current) return;
      const restored = { ...item, ...data.saved };
      setAuthorities((items) => {
        const existing = items.some((candidate) => candidate.id === item.id);
        return existing
          ? items.map((candidate) =>
              candidate.id === item.id ? restored : candidate,
            )
          : [restored, ...items];
      });
    } catch (caught) {
      if (controller.signal.aborted || version !== ownerVersion.current) return;
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not restore saved document.",
      );
    } finally {
      if (undoController.current === controller) undoController.current = null;
    }
  }

  async function loadMore() {
    if (!visibleNextCursor || loadingMore || !ownerStateIsCurrent) return;
    const controller = new AbortController();
    paginationController.current?.abort();
    paginationController.current = controller;
    try {
      await loadLibrary({
        cursor: visibleNextCursor,
        append: true,
        signal: controller.signal,
      });
    } finally {
      if (paginationController.current === controller)
        paginationController.current = null;
    }
  }

  if (isPending) {
    return (
      <p className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted">
        Loading saved workspace…
      </p>
    );
  }

  if (!ownerId || (ownerStateIsCurrent && authRequired)) {
    return (
      <SavedFeatureAuthPrompt
        next="/saved"
        title="Sign in or create an account to use Saved"
        body="Saved documents and private annotations are visible only to your account."
      />
    );
  }

  if (!ownerStateIsCurrent || (loading && visibleAuthorities.length === 0)) {
    return (
      <p className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted">
        Loading saved workspace…
      </p>
    );
  }

  return (
    <>
      <section className="rounded-2xl border border-border bg-surface p-5">
        {error && (
          <p
            role="alert"
            className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
          >
            {error}
          </p>
        )}
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-xl font-medium text-foreground">
              Saved documents
            </h2>
            <p className="mt-1 text-xs text-muted-2">
              Bookmarks and documents with private annotations
            </p>
          </div>
          <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted-2">
            {visibleAuthorities.length} {visibleNextCursor ? "loaded" : "total"}
          </span>
        </div>
        {visibleAuthorities.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-strong p-5 text-sm text-muted">
            <p className="font-medium text-foreground">Nothing saved yet.</p>
            <p className="mt-1">
              Save a document or annotate a passage and it will appear here.
            </p>
            <Link
              href="/"
              className="mt-3 inline-flex rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted transition-colors hover:border-accent hover:text-accent"
            >
              Go to Search
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {visibleAuthorities.map((item) => (
              <li
                key={item.id}
                className="relative rounded-xl border border-border bg-background transition-colors hover:border-border-strong hover:bg-surface-2"
              >
                <Link href={item.path} className="block p-4 pr-14">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">
                    {docLabel(item.docType)}
                  </span>
                  <span className="mt-1 block font-serif text-lg font-medium leading-snug text-foreground">
                    {item.title}
                  </span>
                  {item.citation && (
                    <span className="mt-1 block text-xs text-muted">
                      {item.citation}
                    </span>
                  )}
                  <span className="mt-2 block text-xs text-muted-2">
                    {item.savedAt
                      ? `Saved ${formatDate(item.savedAt)}`
                      : `Added from an annotation ${formatDate(item.createdAt)}`}
                    {` · ${item.annotationCount} annotation${item.annotationCount === 1 ? "" : "s"}`}
                    {` · Active ${formatDate(item.activityAt)}`}
                  </span>
                </Link>
                {item.savedAt && (
                  <button
                    type="button"
                    onClick={() => void removeAuthority(item)}
                    disabled={removingId !== null}
                    aria-label={`Unsave ${item.title}`}
                    title="Unsave"
                    className="absolute right-3 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-2 transition-colors hover:bg-border hover:text-foreground disabled:opacity-50"
                  >
                    <XIcon className="h-4 w-4" />
                  </button>
                )}
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
            {loadingMore ? "Loading…" : "Load more documents"}
          </button>
        )}
      </section>

      {visibleUndoToast && (
        <output
          aria-live="polite"
          className="fixed bottom-5 left-1/2 z-50 flex w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 items-center justify-between gap-3 rounded-2xl border border-border bg-foreground px-4 py-3 text-sm text-background shadow-lg"
        >
          <span>{visibleUndoToast.message}</span>
          <button
            type="button"
            onClick={() => void undoRemove()}
            className="shrink-0 rounded-full bg-background px-3 py-1 text-xs font-semibold text-foreground transition-opacity hover:opacity-80"
          >
            Undo
          </button>
        </output>
      )}
    </>
  );
}
