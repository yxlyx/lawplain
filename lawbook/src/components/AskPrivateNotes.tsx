"use client";

import { useCallback, useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

type ManifestItem = {
  kind: "annotation" | "documentNote";
  id: string;
  title: string;
  citation: string;
  label: string | null;
  sourcePreview: string | null;
  notePreview: string | null;
  hasNote: boolean;
};

type Manifest = {
  items: ManifestItem[];
  annotationCount: number;
  documentNoteCount: number;
  includesNoteText: boolean;
  caveat: string;
};

type Candidate = {
  annotationId: string;
  title: string;
  citation: string;
  exactText: string;
  note: string | null;
};

/**
 * Choose private notes to include in an Ask request (#200).
 *
 * The contract this UI has to keep visible, not merely obey:
 *
 *   - Off by default, and off again next time. Consent is per request; nothing
 *     is remembered, so there is deliberately no "always allow".
 *   - Nothing is included without being named. The reader ticks specific
 *     passages, and an empty selection means nothing rather than everything.
 *   - What is shown is what is sent. The manifest comes back from the server,
 *     built from the same rows the request will use, so it cannot drift.
 */
export function AskPrivateNotes({
  onConsentChange,
}: {
  /** Hands the parent the exact consent payload, or null when off. */
  onConsentChange?: (consent: unknown | null) => void;
}) {
  const { data: session } = authClient.useSession();
  const ownerId = session?.user.id ?? null;
  const [enabled, setEnabled] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [error, setError] = useState<string | null>(null);

  const consent =
    enabled && chosen.size > 0
      ? {
          includePrivateNotes: true,
          annotationIds: [...chosen],
          documentNoteAuthorityIds: [],
        }
      : null;

  // Load the reader's annotations only once they have asked to include some.
  useEffect(() => {
    if (!enabled || !ownerId) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/annotations?limit=50", {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Could not load your annotations.");
        const body = (await response.json()) as { annotations: Candidate[] };
        if (!cancelled) setCandidates(body.annotations ?? []);
      } catch (caught) {
        if (!cancelled)
          setError(
            caught instanceof Error
              ? caught.message
              : "Could not load your annotations.",
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, ownerId]);

  // Preview exactly what would be sent, from the server, before anything is.
  const preview = useCallback(async () => {
    if (!consent) {
      setManifest(null);
      return;
    }
    try {
      const response = await fetch("/api/ask-private-context", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ consent, preview: true }),
      });
      if (!response.ok) throw new Error("Could not check what would be sent.");
      const body = (await response.json()) as { manifest: Manifest };
      setManifest(body.manifest);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not check what would be sent.",
      );
    }
  }, [consent]);

  useEffect(() => {
    void preview();
    onConsentChange?.(consent);
    // `consent` is derived from enabled + chosen, which are the real inputs.
  }, [preview, consent, onConsentChange]);

  // Turning it off must clear the selection too, so re-enabling starts from
  // nothing rather than silently restoring a previous choice.
  function toggle(next: boolean) {
    setEnabled(next);
    if (!next) {
      setChosen(new Set());
      setManifest(null);
    }
  }

  if (!ownerId) return null;

  return (
    <section className="mt-3 rounded-xl border border-border bg-surface p-3">
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => toggle(event.target.checked)}
          className="mt-0.5"
        />
        <span>
          <span className="text-sm font-medium text-foreground">
            Include my private notes in this question
          </span>
          <span className="mt-0.5 block text-[11px] text-muted-2">
            Off by default, and only for this question — nothing is remembered.
          </span>
        </span>
      </label>

      {enabled && (
        <div className="mt-3">
          {error && (
            <p role="alert" className="text-[11px] text-accent">
              {error}
            </p>
          )}
          {candidates.length === 0 ? (
            <p className="text-[11px] text-muted">
              You have no highlighted passages to include yet.
            </p>
          ) : (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">
                Choose what to include
              </p>
              <ul className="mt-1.5 flex max-h-56 flex-col gap-1 overflow-y-auto">
                {candidates.map((candidate) => (
                  <li key={candidate.annotationId}>
                    <label className="flex items-start gap-2 rounded-lg px-1.5 py-1 hover:bg-surface-2">
                      <input
                        type="checkbox"
                        checked={chosen.has(candidate.annotationId)}
                        onChange={(event) =>
                          setChosen((current) => {
                            const next = new Set(current);
                            if (event.target.checked)
                              next.add(candidate.annotationId);
                            else next.delete(candidate.annotationId);
                            return next;
                          })
                        }
                        className="mt-1"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-xs text-foreground">
                          {candidate.exactText.slice(0, 90)}
                        </span>
                        <span className="block text-[10px] text-muted-2">
                          {candidate.title}
                          {candidate.citation ? ` · ${candidate.citation}` : ""}
                          {candidate.note ? " · has your note" : ""}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>

              {manifest && manifest.items.length > 0 && (
                <div className="mt-2 rounded-lg border border-accent/40 bg-accent-soft px-2.5 py-2">
                  <p className="text-[11px] font-medium text-foreground">
                    {manifest.annotationCount} passage
                    {manifest.annotationCount === 1 ? "" : "s"} will be sent
                    {manifest.includesNoteText
                      ? ", including your own note text"
                      : ", with no note text"}
                    .
                  </p>
                  <p className="mt-1 text-[10px] text-muted-2">
                    {manifest.caveat}
                  </p>
                </div>
              )}
              {chosen.size === 0 && (
                <p className="mt-2 text-[11px] text-muted">
                  Nothing selected, so nothing will be included.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
