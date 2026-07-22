"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import type { SavedQuote } from "@/lib/saved-quotes";

function quoteTargetPath(quote: SavedQuote) {
  const url = new URL(quote.path, "https://lawplain.invalid");
  url.searchParams.set("savedQuote", quote.id);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function SavedQuotes() {
  const { data: session } = authClient.useSession();
  const [quotes, setQuotes] = useState<SavedQuote[]>([]);
  const [undo, setUndo] = useState<SavedQuote | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    if (!session?.user) {
      setQuotes([]);
      setUndo(null);
      return;
    }
    let ignore = false;
    void fetch("/api/quotes", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load quotes.");
        const data = (await res.json()) as { quotes?: SavedQuote[] };
        if (!ignore) setQuotes(data.quotes ?? []);
      })
      .catch((err: Error) => !ignore && setError(err.message));
    return () => {
      ignore = true;
    };
  }, [session?.user]);

  if (!session?.user) return null;

  async function remove(quote: SavedQuote) {
    if (deletingId) return;
    setDeletingId(quote.id);
    setError(null);
    try {
      const res = await fetch(`/api/quotes/${encodeURIComponent(quote.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { quote: SavedQuote };
      setQuotes((items) => items.filter((item) => item.id !== quote.id));
      setUndo(data.quote);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setUndo(null), 9000);
    } catch {
      setError("Could not delete quote.");
    } finally {
      setDeletingId(null);
    }
  }

  async function restore() {
    if (!undo || restoring) return;
    const quote = undo;
    setRestoring(true);
    setError(null);
    if (timer.current) window.clearTimeout(timer.current);
    try {
      const res = await fetch(`/api/quotes/${encodeURIComponent(quote.id)}`, {
        method: "POST",
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { quote: SavedQuote };
      setQuotes((items) => [data.quote, ...items]);
      setUndo(null);
    } catch {
      setUndo(null);
      setError("Could not restore quote. The undo period may have expired.");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <>
      <section className="mt-6 rounded-2xl border border-border bg-surface p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-serif text-xl font-medium text-foreground">
            Saved quotes
          </h2>
          <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted-2">
            {quotes.length}
          </span>
        </div>
        {error && (
          <p role="alert" className="mb-3 text-sm text-accent">
            {error}
          </p>
        )}
        {quotes.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border-strong p-5 text-sm text-muted">
            Select text in a judgment or statute and choose Save quote.
          </p>
        ) : (
          <ul className="space-y-3">
            {quotes.map((quote) => (
              <li
                key={quote.id}
                className="rounded-xl border border-border bg-background p-4"
              >
                <Link
                  href={quoteTargetPath(quote)}
                  aria-label={`Open saved quote in ${quote.sourceTitle}`}
                  className="block rounded-md hover:text-accent"
                >
                  <blockquote className="line-clamp-4 font-serif text-foreground transition-colors hover:text-accent">
                    “{quote.exactText}”
                  </blockquote>
                </Link>
                <div className="mt-3 flex items-end justify-between gap-3">
                  <Link
                    href={quoteTargetPath(quote)}
                    className="min-w-0 text-xs text-muted hover:text-accent"
                  >
                    <span className="block truncate font-medium">
                      {quote.sourceTitle}
                    </span>
                    <span>
                      {quote.citation} ·{" "}
                      {new Date(quote.createdAt).toLocaleDateString()}
                    </span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => void remove(quote)}
                    disabled={deletingId !== null}
                    aria-label={`Delete quote from ${quote.sourceTitle}`}
                    className="text-xs font-medium text-muted hover:text-accent disabled:opacity-60"
                  >
                    {deletingId === quote.id ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {undo && (
        <output
          aria-live="polite"
          className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-2xl bg-foreground px-4 py-3 text-sm text-background shadow-lg"
        >
          <span>Quote deleted.</span>
          <button
            type="button"
            onClick={() => void restore()}
            disabled={restoring}
            className="rounded-full bg-background px-3 py-1 text-xs font-semibold text-foreground disabled:opacity-60"
          >
            {restoring ? "Restoring…" : "Undo"}
          </button>
        </output>
      )}
    </>
  );
}
