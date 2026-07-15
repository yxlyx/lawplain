"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { XIcon } from "@/components/icons";
import { authClient } from "@/lib/auth-client";
import type { RecentDocumentType } from "@/lib/recently-viewed";

interface RecentlyViewedDocument {
  id: string;
  docType: RecentDocumentType;
  docId: string;
  title: string;
  path: string;
  viewedAt: number;
}

function formatDate(ts: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(ts));
}

function docLabel(docType: RecentDocumentType): string {
  switch (docType) {
    case "judgment":
      return "Judgment";
    case "statute":
      return "Statute";
    case "hansard":
      return "Hansard";
    case "bills":
      return "Bill";
    case "subsidiary":
      return "Subsidiary Leg.";
    case "practice":
      return "Practice Direction";
    case "guidance":
      return "Guidance";
  }
}

export function RecentlyViewedDocuments() {
  const { data: session } = authClient.useSession();
  const [documents, setDocuments] = useState<RecentlyViewedDocument[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!session?.user) return;
    let ignore = false;
    void (async () => {
      try {
        const res = await fetch("/api/recently-viewed?limit=50", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          documents?: RecentlyViewedDocument[];
        };
        if (!ignore) setDocuments(data.documents ?? []);
      } catch {
        // best-effort
      } finally {
        if (!ignore) setLoaded(true);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [session?.user]);

  if (!session?.user || !loaded) return null;

  async function remove(item: RecentlyViewedDocument) {
    const previous = documents;
    setDocuments((docs) => docs.filter((doc) => doc.id !== item.id));
    try {
      const res = await fetch(
        `/api/recently-viewed?docType=${item.docType}&docId=${encodeURIComponent(item.docId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error();
    } catch {
      setDocuments(previous);
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-border bg-surface p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-serif text-xl font-medium text-foreground">
          Recently viewed
        </h2>
        <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted-2">
          {documents.length}
        </span>
      </div>

      {documents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-strong p-5 text-sm text-muted">
          <p className="font-medium text-foreground">
            No recent documents yet.
          </p>
          <p className="mt-1">
            Documents you have opened while signed in will appear here.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {documents.map((item) => (
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
                <span className="mt-2 block text-xs text-muted-2">
                  Viewed {formatDate(item.viewedAt)}
                </span>
              </Link>
              <button
                type="button"
                onClick={() => void remove(item)}
                aria-label={`Remove recently viewed document: ${item.title}`}
                title="Remove"
                className="absolute right-3 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-2 transition-colors hover:bg-border hover:text-foreground"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
