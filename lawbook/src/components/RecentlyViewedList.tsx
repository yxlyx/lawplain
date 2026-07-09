"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { HistoryIcon } from "@/components/icons";
import { SavedFeatureAuthPrompt } from "@/components/SavedFeatureAuthPrompt";
import { authClient } from "@/lib/auth-client";

type RecentlyViewedDocument = {
  id: string;
  docType: string;
  docId: string;
  title: string;
  path: string;
  viewedAt: number;
};

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(ts));
}

function docLabel(docType: string): string {
  const map: Record<string, string> = {
    judgment: "Judgment",
    statute: "Statute",
    hansard: "Hansard",
    bills: "Bill",
    subsidiary: "Subsidiary Leg.",
    practice: "Practice Dir.",
  };
  return map[docType] ?? docType;
}

export function RecentlyViewedList() {
  const { data: session, isPending } = authClient.useSession();
  const [documents, setDocuments] = useState<RecentlyViewedDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);

  const fetchRecent = useCallback(async () => {
    const res = await fetch("/api/recently-viewed?limit=50", {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const payload = (await res.json().catch(() => null)) as {
      documents?: RecentlyViewedDocument[];
    } | null;
    return payload?.documents ?? [];
  }, []);

  useEffect(() => {
    if (!session?.user) {
      setDocuments([]);
      setError(null);
      setLoading(false);
      setAuthRequired(false);
      return;
    }
    let ignore = false;

    async function load() {
      setLoading(true);
      setError(null);
      setAuthRequired(false);
      try {
        const res = await fetch("/api/recently-viewed?limit=50", {
          cache: "no-store",
        });
        if (res.status === 401) {
          if (!ignore) {
            setDocuments([]);
            setAuthRequired(true);
          }
          return;
        }
        if (!res.ok) {
          if (!ignore) {
            setDocuments([]);
            setError("Could not load recently viewed documents.");
          }
          return;
        }
        const data = (await res.json()) as {
          documents?: RecentlyViewedDocument[];
        };
        if (!ignore) setDocuments(data.documents ?? []);
      } catch (err) {
        if (!ignore) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not load recently viewed documents.",
          );
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    void load();
    return () => {
      ignore = true;
    };
  }, [session?.user]);

  async function clearAll() {
    setDocuments([]);
    const res = await fetch("/api/recently-viewed", {
      method: "DELETE",
    }).catch(() => null);
    if (!res?.ok) {
      const docs = await fetchRecent().catch(() => null);
      if (docs) setDocuments(docs);
    }
  }

  if (isPending) {
    return (
      <p className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted">
        Loading recently viewed…
      </p>
    );
  }

  if (!session?.user || authRequired) {
    return (
      <SavedFeatureAuthPrompt
        next="/recents"
        title="Sign in to track recently viewed documents"
        body="Sign in or create an account to get started."
      />
    );
  }

  if (loading) {
    return (
      <p className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted">
        Loading recently viewed…
      </p>
    );
  }

  if (error && documents.length === 0) {
    return (
      <div className="rounded-2xl border border-red-100 bg-red-50 p-6 text-sm text-red-700">
        <p>{error}</p>
        <p className="mt-2 text-red-700/80">
          If this is local/dev, run the recently-viewed D1 migration, then try
          again.
        </p>
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      {error && (
        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {error}
        </p>
      )}
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-serif text-xl font-medium text-foreground">
          Recently viewed
        </h2>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted-2">
            {documents.length}
          </span>
          {documents.length > 0 && (
            <button
              type="button"
              onClick={() => void clearAll()}
              className="rounded-full px-2.5 py-1 text-xs font-medium text-muted-2 transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
      </div>
      {documents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-strong p-5 text-sm text-muted">
          <p className="font-medium text-foreground">
            No recently viewed documents.
          </p>
          <p className="mt-1">
            Documents you have opened while signed in will appear here.
          </p>
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
          {documents.map((item) => (
            <li
              key={item.id}
              className="relative rounded-xl border border-border bg-background transition-colors hover:border-border-strong hover:bg-surface-2"
            >
              <Link href={item.path} className="block p-4">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-2">
                  <HistoryIcon className="h-3 w-3" />
                  {docLabel(item.docType)}
                </span>
                <span className="mt-1 block font-serif text-lg font-medium leading-snug text-foreground">
                  {item.title}
                </span>
                <span className="mt-2 block text-xs text-muted-2">
                  Viewed {formatRelative(item.viewedAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
