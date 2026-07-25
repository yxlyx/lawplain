"use client";

import { useCallback, useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

type Kind = "tag" | "collection";

type Group = {
  id: string;
  kind: Kind;
  name: string;
  description: string | null;
  archivedAt: number | null;
  documentCount: number;
};

const WORDS: Record<Kind, { one: string; many: string }> = {
  tag: { one: "tag", many: "Tags" },
  collection: { one: "collection", many: "Collections" },
};

/**
 * Rename, archive, merge and delete tags and collections (#197).
 *
 * Every destructive action states what it keeps, because the thing a reader
 * actually fears here is losing research: deleting a tag removes the tag and its
 * memberships, never a document or an annotation.
 */
export function ResearchGroupManager() {
  const { data: session } = authClient.useSession();
  const ownerId = session?.user.id ?? null;
  const [kind, setKind] = useState<Kind>("tag");
  const [groups, setGroups] = useState<Group[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [mergingId, setMergingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const words = WORDS[kind];

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/research-groups?kind=${kind}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Could not load them.");
      const body = (await response.json()) as { groups: Group[] };
      setGroups(body.groups ?? []);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not load them.",
      );
    }
  }, [kind]);

  useEffect(() => {
    if (open && ownerId) void load();
  }, [open, ownerId, load]);

  async function patch(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch(`/api/research-groups/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, ...body }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? "Could not update it.");
      }
      await load();
      window.dispatchEvent(new Event("lawplain:library-changed"));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not update it.",
      );
    } finally {
      setBusyId(null);
      setRenamingId(null);
      setMergingId(null);
    }
  }

  async function remove(group: Group) {
    setBusyId(group.id);
    setError(null);
    try {
      const response = await fetch(
        `/api/research-groups/${group.id}?kind=${kind}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error("Could not delete it.");
      await load();
      window.dispatchEvent(new Event("lawplain:library-changed"));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not delete it.",
      );
    } finally {
      setBusyId(null);
      setConfirmingId(null);
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
          Manage tags and collections
        </button>
      </div>
    );
  }

  return (
    <section className="mt-4 rounded-2xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">
          Manage {words.many.toLowerCase()}
        </h3>
        <div className="flex items-center gap-1.5">
          {(["tag", "collection"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={kind === option}
              onClick={() => setKind(option)}
              className={
                kind === option
                  ? "rounded-full border border-accent bg-accent/10 px-3 py-1 text-xs font-medium text-foreground"
                  : "rounded-full border border-border px-3 py-1 text-xs font-medium text-muted hover:border-accent"
              }
            >
              {WORDS[option].many}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-full px-2.5 py-1 text-xs font-medium text-muted hover:bg-surface-2"
          >
            Done
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs text-accent">
          {error}
        </p>
      )}

      {groups.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-border-strong px-3 py-2 text-sm text-muted">
          No {words.many.toLowerCase()} yet. Add one from a document card.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {groups.map((group) => (
            <li
              key={group.id}
              className="rounded-xl border border-border bg-background p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                {renamingId === group.id ? (
                  <>
                    <input
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      aria-label={`Rename ${group.name}`}
                      className="min-w-0 flex-1 rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-foreground outline-none focus:border-accent"
                    />
                    <button
                      type="button"
                      disabled={busyId === group.id || !draft.trim()}
                      onClick={() =>
                        void patch(group.id, { name: draft.trim() })
                      }
                      className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-primary-fg disabled:opacity-60"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenamingId(null)}
                      className="rounded-full px-2.5 py-1 text-xs text-muted hover:bg-surface-2"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-sm font-medium text-foreground">
                      {group.name}
                    </span>
                    <span className="text-[11px] text-muted-2">
                      {group.documentCount} document
                      {group.documentCount === 1 ? "" : "s"}
                      {group.archivedAt ? " · Archived" : ""}
                    </span>
                  </>
                )}
              </div>

              {mergingId === group.id ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-muted-2">
                    Move its documents into:
                  </span>
                  {groups
                    .filter((other) => other.id !== group.id)
                    .map((other) => (
                      <button
                        key={other.id}
                        type="button"
                        disabled={busyId === group.id}
                        onClick={() =>
                          void patch(group.id, { mergeInto: other.id })
                        }
                        className="rounded-full border border-border px-2.5 py-0.5 text-[11px] font-medium text-muted hover:border-accent disabled:opacity-60"
                      >
                        {other.name}
                      </button>
                    ))}
                  <button
                    type="button"
                    onClick={() => setMergingId(null)}
                    className="rounded-full px-2 py-0.5 text-[11px] text-muted hover:bg-surface-2"
                  >
                    Cancel
                  </button>
                </div>
              ) : confirmingId === group.id ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-muted">
                    Delete “{group.name}”? Your documents and highlights are
                    kept — only the {words.one} and its memberships go.
                  </span>
                  <button
                    type="button"
                    disabled={busyId === group.id}
                    onClick={() => void remove(group)}
                    className="rounded-full border border-border px-2.5 py-0.5 text-[11px] font-medium text-muted hover:border-danger-border hover:text-danger disabled:opacity-60"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingId(null)}
                    className="rounded-full px-2 py-0.5 text-[11px] text-muted hover:bg-surface-2"
                  >
                    Keep
                  </button>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setRenamingId(group.id);
                      setDraft(group.name);
                    }}
                    className="rounded-full border border-border px-2.5 py-0.5 text-[11px] font-medium text-muted hover:border-accent"
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    disabled={busyId === group.id}
                    onClick={() =>
                      void patch(group.id, { archived: !group.archivedAt })
                    }
                    className="rounded-full border border-border px-2.5 py-0.5 text-[11px] font-medium text-muted hover:border-accent disabled:opacity-60"
                  >
                    {group.archivedAt ? "Unarchive" : "Archive"}
                  </button>
                  {groups.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setMergingId(group.id)}
                      className="rounded-full border border-border px-2.5 py-0.5 text-[11px] font-medium text-muted hover:border-accent"
                    >
                      Merge into…
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setConfirmingId(group.id)}
                    className="rounded-full border border-border px-2.5 py-0.5 text-[11px] font-medium text-muted hover:border-danger-border hover:text-danger"
                  >
                    Delete
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
