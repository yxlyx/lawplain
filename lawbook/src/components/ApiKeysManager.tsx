"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CheckIcon, CopyIcon, XIcon } from "@/components/icons";
import { authClient } from "@/lib/auth-client";

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

function fmt(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function ApiKeysManager() {
  const { data: session, isPending } = authClient.useSession();
  const isSignedIn = Boolean(session?.user);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/keys").catch(() => null);
    if (res?.ok) {
      const data = (await res.json()) as { keys?: ApiKey[] };
      setKeys(data.keys ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isSignedIn) void refresh();
    else setLoading(false);
  }, [isSignedIn, refresh]);

  async function create() {
    setCreating(true);
    setError(null);
    setFreshKey(null);
    const res = await fetch("/api/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim() || "API key" }),
    }).catch(() => null);
    setCreating(false);
    if (!res) {
      setError("Network error. Please try again.");
      return;
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      setError(body?.error ?? "Could not create the key.");
      return;
    }
    const data = (await res.json()) as { key: string };
    setFreshKey(data.key);
    setName("");
    void refresh();
  }

  async function revoke(id: string) {
    setKeys((ks) => ks.filter((k) => k.id !== id));
    await fetch(`/api/keys?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).catch(() => {});
  }

  async function copyFresh() {
    if (!freshKey) return;
    await navigator.clipboard.writeText(freshKey).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (isPending || (loading && isSignedIn)) {
    return <p className="text-sm text-muted-2">Loading…</p>;
  }

  if (!isSignedIn) {
    return (
      <div className="rounded-xl border border-border bg-surface-2/40 p-5 text-sm text-muted">
        <Link href="/sign-in" className="font-medium text-accent underline">
          Sign in
        </Link>{" "}
        to create API keys for your agents.
      </div>
    );
  }

  const active = keys.filter((k) => !k.revokedAt);

  return (
    <div className="flex flex-col gap-5">
      {freshKey && (
        <div className="rounded-xl border border-accent/40 bg-accent-soft p-4">
          <p className="text-sm font-medium text-foreground">
            Your new API key — copy it now, it won't be shown again.
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-background px-3 py-2 font-mono text-[13px] text-foreground">
              {freshKey}
            </code>
            <button
              type="button"
              onClick={copyFresh}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-2"
            >
              {copied ? (
                <CheckIcon className="h-4 w-4 text-accent" />
              ) : (
                <CopyIcon className="h-4 w-4" />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Key name (e.g. my-agent)"
          maxLength={80}
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface-2/50 px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-2 focus:border-border-strong focus:bg-background"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !creating) void create();
          }}
        />
        <button
          type="button"
          onClick={() => void create()}
          disabled={creating}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-primary-fg transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {creating ? "Creating…" : "Create key"}
        </button>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}

      {active.length === 0 ? (
        <p className="text-sm text-muted-2">No keys yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
          {active.map((k) => (
            <li
              key={k.id}
              className="flex items-center gap-3 px-4 py-3 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">{k.name}</p>
                <p className="mt-0.5 font-mono text-xs text-muted-2">
                  {k.prefix}…&nbsp;·&nbsp;created {fmt(k.createdAt)}
                  {k.lastUsedAt ? ` · last used ${fmt(k.lastUsedAt)}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void revoke(k.id)}
                aria-label="Revoke key"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-2 transition-colors hover:bg-surface-2 hover:text-red-500"
              >
                <XIcon className="h-3.5 w-3.5" />
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
