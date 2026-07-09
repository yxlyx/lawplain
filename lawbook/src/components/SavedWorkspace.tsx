"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { XIcon } from "@/components/icons";
import { SavedFeatureAuthPrompt } from "@/components/SavedFeatureAuthPrompt";
import { authClient } from "@/lib/auth-client";

type SavedAuthority = {
  id: string;
  docType: "judgment" | "statute";
  docId: string;
  title: string;
  path: string;
  updatedAt: number;
};

type UndoToast = {
  item: SavedAuthority;
  message: string;
};

function formatDate(ts: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(ts));
}

function docLabel(docType: SavedAuthority["docType"]): string {
  return docType === "judgment" ? "Judgment" : "Statute";
}

export function SavedWorkspace() {
  const { data: session, isPending } = authClient.useSession();
  const [authorities, setAuthorities] = useState<SavedAuthority[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [undoToast, setUndoToast] = useState<UndoToast | null>(null);
  const undoTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!session?.user) {
      setAuthorities([]);
      setError(null);
      setLoading(false);
      setAuthRequired(false);
      setUndoToast(null);
      return;
    }
    let ignore = false;

    async function loadSaved() {
      setLoading(true);
      setError(null);
      setAuthRequired(false);
      try {
        const savedRes = await fetch("/api/saved", { cache: "no-store" });

        if (savedRes.status === 401) {
          if (!ignore) {
            setAuthorities([]);
            setAuthRequired(true);
          }
          return;
        }

        if (!savedRes.ok) {
          if (!ignore) {
            setAuthorities([]);
            setError(
              "Could not load saved documents. If you just added Saved, run the D1 migrations and refresh.",
            );
          }
          return;
        }

        const savedData = (await savedRes.json()) as {
          authorities?: SavedAuthority[];
        };
        if (!ignore) setAuthorities(savedData.authorities ?? []);
      } catch (err) {
        if (!ignore) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not load saved documents.",
          );
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    void loadSaved();

    return () => {
      ignore = true;
    };
  }, [session?.user]);

  function showUndoToast(item: SavedAuthority) {
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    setUndoToast({
      item,
      message: `${docLabel(item.docType)} unsaved.`,
    });
    undoTimer.current = window.setTimeout(() => setUndoToast(null), 5000);
  }

  async function removeAuthority(item: SavedAuthority) {
    setError(null);
    setAuthorities((items) =>
      items.filter(
        (candidate) =>
          !(
            candidate.docType === item.docType && candidate.docId === item.docId
          ),
      ),
    );
    showUndoToast(item);

    try {
      const res = await fetch(
        `/api/saved?docType=${item.docType}&docId=${encodeURIComponent(item.docId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Could not remove saved document.");
    } catch (err) {
      setAuthorities((items) => [item, ...items]);
      setUndoToast(null);
      setError(
        err instanceof Error ? err.message : "Could not remove saved document.",
      );
    }
  }

  async function undoRemove() {
    if (!undoToast) return;
    const { item } = undoToast;
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    setUndoToast(null);
    setError(null);

    try {
      const res = await fetch("/api/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docType: item.docType,
          docId: item.docId,
          title: item.title,
          path: item.path,
        }),
      });
      if (!res.ok) throw new Error("Could not restore saved document.");
      const data = (await res.json()) as { saved?: SavedAuthority };
      setAuthorities((items) => [data.saved ?? item, ...items]);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not restore saved document.",
      );
    }
  }

  if (isPending) {
    return (
      <p className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted">
        Loading saved workspace…
      </p>
    );
  }

  if (!session?.user || authRequired) {
    return (
      <SavedFeatureAuthPrompt
        next="/saved"
        title="Sign in or create an account to use Saved"
        body="Saved documents are private to your account. Sign in or create an account to keep documents."
      />
    );
  }

  if (loading) {
    return (
      <p className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted">
        Loading saved workspace…
      </p>
    );
  }

  if (error && authorities.length === 0) {
    return (
      <div className="rounded-2xl border border-red-100 bg-red-50 p-6 text-sm text-red-700">
        <p>{error}</p>
        <p className="mt-2 text-red-700/80">
          If this is local/dev, run the saved-workspace D1 migration, then try
          saving again.
        </p>
      </div>
    );
  }

  return (
    <>
      <section className="rounded-2xl border border-border bg-surface p-5">
        {error && (
          <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            {error}
          </p>
        )}
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-serif text-xl font-medium text-foreground">
            Saved documents
          </h2>
          <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted-2">
            {authorities.length}
          </span>
        </div>
        {authorities.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-strong p-5 text-sm text-muted">
            <p className="font-medium text-foreground">Nothing saved yet.</p>
            <p className="mt-1">Save a document and it will appear here.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href="/"
                className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted transition-colors hover:border-accent hover:text-accent"
              >
                Go to Search
              </Link>
            </div>
          </div>
        ) : (
          <ul className="space-y-3">
            {authorities.map((item) => (
              <li
                key={item.id}
                className="relative rounded-xl border border-border bg-background transition-colors hover:border-border-strong hover:bg-surface-2"
              >
                <Link href={item.path} className="block p-4 pr-14">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">
                    {item.docType}
                  </span>
                  <span className="mt-1 block font-serif text-lg font-medium leading-snug text-foreground">
                    {item.title}
                  </span>
                  <span className="mt-2 block text-xs text-muted-2">
                    Saved {formatDate(item.updatedAt)}
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => void removeAuthority(item)}
                  aria-label={`Unsave ${item.title}`}
                  title="Unsave"
                  className="absolute right-3 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-2 transition-colors hover:bg-border hover:text-foreground"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {undoToast && (
        <output
          aria-live="polite"
          className="fixed bottom-5 left-1/2 z-50 flex w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 items-center justify-between gap-3 rounded-2xl border border-border bg-foreground px-4 py-3 text-sm text-background shadow-lg"
        >
          <span>{undoToast.message}</span>
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
