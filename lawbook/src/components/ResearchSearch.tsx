"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { resolveAnnotationLabel } from "@/lib/annotation-labels";
import { authClient } from "@/lib/auth-client";

type MatchField =
  | "title"
  | "citation"
  | "passage"
  | "passageNote"
  | "documentNote";

type Hit = {
  kind: "annotation" | "documentNote" | "document";
  authorityId: string;
  annotationId: string | null;
  docType: "judgment" | "statute";
  docId: string;
  title: string;
  citation: string;
  path: string;
  label: string | null;
  sourceText: string | null;
  noteText: string | null;
  matchedIn: MatchField[];
  updatedAt: number;
};

const WHY: Record<MatchField, string> = {
  title: "title",
  citation: "citation",
  passage: "the passage",
  passageNote: "your note on the passage",
  documentNote: "your note on the document",
};

/** A result links back to the exact annotation, so it can be restored in place. */
function targetPath(hit: Hit): string {
  if (!hit.annotationId) return hit.path;
  const url = new URL(hit.path, "https://lawplain.invalid");
  url.searchParams.set("savedQuote", hit.annotationId);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Search your own research (#196) — passages, passage notes, document notes and
 * document titles. Only ever the signed-in reader's own corpus; the query is not
 * recorded anywhere.
 */
export function ResearchSearch() {
  const { data: session } = authClient.useSession();
  const ownerId = session?.user.id ?? null;
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [state, setState] = useState<"idle" | "searching" | "done" | "error">(
    "idle",
  );
  const [message, setMessage] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const version = useRef(0);

  const run = useCallback(async (term: string) => {
    const trimmed = term.trim();
    controller.current?.abort();
    if (!trimmed) {
      setHits([]);
      setState("idle");
      setMessage(null);
      return;
    }
    const mine = ++version.current;
    const abort = new AbortController();
    controller.current = abort;
    setState("searching");
    setMessage(null);
    try {
      const params = new URLSearchParams({ q: trimmed, limit: "25" });
      const response = await fetch(`/api/research-search?${params}`, {
        cache: "no-store",
        signal: abort.signal,
      });
      if (abort.signal.aborted || mine !== version.current) return;
      if (response.status === 401) {
        setState("error");
        setMessage("Sign in to search your research.");
        return;
      }
      if (!response.ok) throw new Error("Could not search your research.");
      const body = (await response.json()) as { results: Hit[] };
      setHits(body.results ?? []);
      setState("done");
    } catch (caught) {
      if (abort.signal.aborted || mine !== version.current) return;
      setState("error");
      setMessage(
        caught instanceof Error
          ? caught.message
          : "Could not search your research.",
      );
    }
  }, []);

  // Debounced, so typing does not fire a request per keystroke.
  useEffect(() => {
    if (!ownerId) return;
    const timer = setTimeout(() => void run(query), 300);
    return () => clearTimeout(timer);
  }, [query, ownerId, run]);

  // Switching account must not leave the previous reader's results on screen.
  const previousOwnerId = useRef(ownerId);
  useEffect(() => {
    if (previousOwnerId.current === ownerId) return;
    previousOwnerId.current = ownerId;
    controller.current?.abort();
    version.current += 1;
    setQuery("");
    setHits([]);
    setState("idle");
    setMessage(null);
  }, [ownerId]);

  if (!ownerId) return null;

  return (
    <section className="mt-6 rounded-2xl border border-border bg-surface p-5">
      <h2 className="font-serif text-xl font-medium text-foreground">
        Search my research
      </h2>
      <p className="mt-1 text-xs text-muted-2">
        Your highlighted passages, your notes, and the documents they are in.
        Nothing you type here is recorded.
      </p>

      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="e.g. duty of care"
        aria-label="Search your research"
        className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
      />

      <output aria-live="polite" className="mt-2 block text-[11px] text-muted">
        {state === "searching" && "Searching…"}
        {state === "error" && message}
        {state === "done" &&
          `${hits.length} result${hits.length === 1 ? "" : "s"}`}
      </output>

      {state === "done" && hits.length === 0 && query.trim() && (
        <p className="mt-2 rounded-lg border border-dashed border-border-strong px-3 py-2 text-sm text-muted">
          Nothing in your research matches “{query.trim()}”.
        </p>
      )}

      {hits.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {hits.map((hit) => (
            <li
              key={`${hit.kind}:${hit.annotationId ?? hit.authorityId}`}
              className="rounded-xl border border-border bg-background p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={targetPath(hit)}
                  className="text-sm font-medium text-foreground hover:text-accent"
                >
                  {hit.title}
                </Link>
                {hit.citation && (
                  <span className="text-xs text-muted-2">{hit.citation}</span>
                )}
                {hit.label && (
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-muted-2">
                    {resolveAnnotationLabel(hit.label).name}
                  </span>
                )}
              </div>

              {/* Source text and the reader's own words never share a block. */}
              {hit.sourceText && (
                <blockquote className="mt-2 border-l-2 border-border-strong pl-2.5 font-serif text-sm text-foreground/90">
                  {hit.sourceText}
                </blockquote>
              )}
              {hit.noteText && (
                <p className="mt-2 border-l-2 border-accent/50 pl-2.5 text-sm italic text-muted">
                  Your note: {hit.noteText}
                </p>
              )}

              <p className="mt-2 text-[11px] text-muted-2">
                Matched in{" "}
                {hit.matchedIn.map((field) => WHY[field]).join(", ") ||
                  "this document"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
