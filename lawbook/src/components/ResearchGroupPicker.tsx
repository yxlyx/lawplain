"use client";

import { useCallback, useEffect, useId, useState } from "react";

type Kind = "tag" | "collection";

type Group = {
  id: string;
  kind: Kind;
  name: string;
  archivedAt: number | null;
  documentCount: number;
};

const WORDS: Record<Kind, { one: string; many: string; add: string }> = {
  tag: { one: "tag", many: "Tags", add: "Add a tag" },
  collection: {
    one: "collection",
    many: "Collections",
    add: "Add to a collection",
  },
};

/**
 * Attach one authority to tags and collections (#197), with inline create.
 *
 * A tag is a topic across documents; a collection groups authorities for a
 * matter. Neither is an annotation label, which describes a single passage — the
 * headings say so, because the three are easy to confuse.
 */
export function ResearchGroupPicker({
  authorityId,
  kind,
  onChanged,
}: {
  authorityId: string;
  kind: Kind;
  onChanged?: () => void;
}) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [member, setMember] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const fieldId = useId();
  const words = WORDS[kind];

  const load = useCallback(async () => {
    try {
      const [all, mine] = await Promise.all([
        fetch(`/api/research-groups?kind=${kind}`, { cache: "no-store" }),
        fetch(
          `/api/research-groups/membership?authorityId=${encodeURIComponent(authorityId)}`,
          { cache: "no-store" },
        ),
      ]);
      if (all.ok) {
        const body = (await all.json()) as { groups: Group[] };
        setGroups((body.groups ?? []).filter((g) => !g.archivedAt));
      }
      if (mine.ok) {
        const body = (await mine.json()) as {
          tags: string[];
          collections: string[];
        };
        setMember(new Set(kind === "tag" ? body.tags : body.collections));
      }
    } catch {
      setError("Could not load your " + words.many.toLowerCase() + ".");
    }
  }, [authorityId, kind, words.many]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function setMembership(groupId: string, next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/research-groups/membership", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, groupId, authorityId, member: next }),
      });
      if (!response.ok) throw new Error("Could not update it.");
      setMember((current) => {
        const copy = new Set(current);
        if (next) copy.add(groupId);
        else copy.delete(groupId);
        return copy;
      });
      onChanged?.();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not update it.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function createAndAttach() {
    const name = creating.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      // Creating an existing name joins it rather than failing, so this is safe
      // to press twice.
      const response = await fetch("/api/research-groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, name }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Could not create it.");
      }
      const body = (await response.json()) as { group: Group };
      setCreating("");
      await setMembership(body.group.id, true);
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not create it.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-border px-2.5 py-0.5 text-[11px] font-medium text-muted hover:border-accent hover:text-foreground"
      >
        {words.add}
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-border bg-surface p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">
          {words.many}
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-full px-2 py-0.5 text-[11px] text-muted hover:bg-surface-2"
        >
          Done
        </button>
      </div>

      {groups.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {groups.map((group) => {
            const attached = member.has(group.id);
            return (
              <button
                key={group.id}
                type="button"
                aria-pressed={attached}
                disabled={busy}
                onClick={() => void setMembership(group.id, !attached)}
                className={
                  attached
                    ? "rounded-full border border-accent bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium text-foreground disabled:opacity-60"
                    : "rounded-full border border-border px-2.5 py-0.5 text-[11px] font-medium text-muted hover:border-accent disabled:opacity-60"
                }
              >
                {group.name}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-2 flex items-center gap-1.5">
        <label className="sr-only" htmlFor={fieldId}>
          New {words.one} name
        </label>
        <input
          id={fieldId}
          value={creating}
          onChange={(event) => setCreating(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void createAndAttach();
            }
          }}
          placeholder={`New ${words.one}…`}
          className="min-w-0 flex-1 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-foreground outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={() => void createAndAttach()}
          disabled={busy || !creating.trim()}
          className="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted hover:border-accent disabled:opacity-60"
        >
          Create
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-1.5 text-[11px] text-accent">
          {error}
        </p>
      )}
    </div>
  );
}
