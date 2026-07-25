"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ANNOTATION_LABELS } from "@/lib/annotation-labels";
import { authClient } from "@/lib/auth-client";

type Excerpt = {
  annotationId: string;
  sourceText: string;
  userNote: string | null;
  label: string;
  labelName: string;
  title: string;
  citation: string;
  url: string;
};

type Outline = {
  grouping: string;
  sections: { heading: string; excerpts: Excerpt[] }[];
  emptyReason: string | null;
};

const GROUPINGS = [
  { id: "label", name: "By label" },
  { id: "authority", name: "By authority" },
  { id: "tag", name: "By tag" },
  { id: "collection", name: "By collection" },
] as const;

/**
 * Turn your own labelled highlights into an outline (#201).
 *
 * No AI: grouping and ordering are deterministic. Source quotations render as
 * blockquotes and the reader's commentary does not, matching the export format,
 * and every excerpt keeps a link back to the passage it came from.
 */
export function ResearchOutline() {
  const { data: session } = authClient.useSession();
  const ownerId = session?.user.id ?? null;
  const [open, setOpen] = useState(false);
  const [grouping, setGrouping] = useState<string>("label");
  const [labels, setLabels] = useState<string[]>([]);
  const [includeNotes, setIncludeNotes] = useState(false);
  const [outline, setOutline] = useState<Outline | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ grouping });
      for (const label of labels) params.append("label", label);
      const response = await fetch(`/api/research-outline?${params}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Could not build the outline.");
      setOutline((await response.json()) as Outline);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not build the outline.",
      );
    } finally {
      setLoading(false);
    }
  }, [grouping, labels]);

  useEffect(() => {
    if (open && ownerId) void load();
  }, [open, ownerId, load]);

  async function copyMarkdown() {
    try {
      const params = new URLSearchParams({ grouping, format: "md" });
      for (const label of labels) params.append("label", label);
      if (includeNotes) params.set("includeNotes", "true");
      const response = await fetch(`/api/research-outline?${params}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as { markdown: string };
      await navigator.clipboard.writeText(body.markdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Could not copy the outline.");
    }
  }

  if (!ownerId) return null;

  if (!open) {
    return (
      <div className="mt-4">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted hover:border-accent hover:text-foreground"
        >
          Build a research outline
        </button>
      </div>
    );
  }

  return (
    <section className="mt-6 rounded-2xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-serif text-xl font-medium text-foreground">
            Research outline
          </h2>
          <p className="mt-1 text-xs text-muted-2">
            Your highlighted passages, grouped. Built from your own notes — no
            AI.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-full px-2.5 py-1 text-xs font-medium text-muted hover:bg-surface-2"
        >
          Hide
        </button>
      </div>

      <fieldset className="mt-3 flex flex-wrap items-center gap-1.5 border-b border-border pb-3">
        <legend className="sr-only">Outline scope</legend>
        <select
          value={grouping}
          onChange={(event) => setGrouping(event.target.value)}
          aria-label="Group by"
          className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted"
        >
          {GROUPINGS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        {ANNOTATION_LABELS.map((label) => {
          const on = labels.includes(label.id);
          return (
            <button
              key={label.id}
              type="button"
              aria-pressed={on}
              onClick={() =>
                setLabels((current) =>
                  on
                    ? current.filter((id) => id !== label.id)
                    : [...current, label.id],
                )
              }
              className={
                on
                  ? "rounded-full border border-accent bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium text-foreground"
                  : "rounded-full border border-border px-2.5 py-0.5 text-[11px] font-medium text-muted hover:border-accent"
              }
            >
              {label.name}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={includeNotes}
          onClick={() => setIncludeNotes((v) => !v)}
          className={
            includeNotes
              ? "ml-auto rounded-full border border-accent bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium text-foreground"
              : "ml-auto rounded-full border border-border px-2.5 py-0.5 text-[11px] font-medium text-muted hover:border-accent"
          }
        >
          {includeNotes
            ? "Copy will include my notes"
            : "Copy without my notes"}
        </button>
        <button
          type="button"
          onClick={() => void copyMarkdown()}
          className="rounded-full border border-border px-2.5 py-0.5 text-[11px] font-medium text-muted hover:border-accent hover:text-foreground"
        >
          {copied ? "Copied" : "Copy as Markdown"}
        </button>
      </fieldset>

      <output aria-live="polite" className="mt-2 block text-[11px] text-muted">
        {loading ? "Building…" : error}
      </output>

      {outline?.emptyReason && (
        <p className="mt-2 rounded-lg border border-dashed border-border-strong px-3 py-2 text-sm text-muted">
          {outline.emptyReason}
        </p>
      )}

      {outline?.sections.map((section) => (
        <div key={section.heading} className="mt-4">
          <h3 className="text-sm font-semibold text-foreground">
            {section.heading}
          </h3>
          {section.excerpts.length === 0 ? (
            <p className="mt-1 text-xs italic text-muted-2">
              Nothing under this heading yet.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {section.excerpts.map((excerpt) => (
                <li
                  key={excerpt.annotationId}
                  className="rounded-xl border border-border bg-background p-3"
                >
                  <blockquote className="border-l-2 border-border-strong pl-2.5 font-serif text-sm text-foreground/90">
                    {excerpt.sourceText}
                  </blockquote>
                  {excerpt.userNote && (
                    <p className="mt-2 border-l-2 border-accent/50 pl-2.5 text-sm italic text-muted">
                      My note: {excerpt.userNote}
                    </p>
                  )}
                  <p className="mt-2 text-[11px] text-muted-2">
                    <Link href={excerpt.url} className="hover:text-accent">
                      {excerpt.title}
                    </Link>
                    {excerpt.citation ? ` · ${excerpt.citation}` : ""}
                    {` · ${excerpt.labelName}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}
