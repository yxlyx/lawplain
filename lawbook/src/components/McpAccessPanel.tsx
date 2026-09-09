"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import type { McpAccess, McpActivity } from "@/server/mcp-store";
import { McpActivityTable } from "./McpActivityTable";

interface Snapshot {
  access: McpAccess | null;
  enabled: boolean;
  isAdmin: boolean;
  activity: McpActivity[];
  summary: { requests: number; successful: number; responseBytes: number };
}

export function McpAccessPanel() {
  const { data: session, isPending } = authClient.useSession();
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const res = await fetch("/api/mcp-access", { cache: "no-store" }).catch(
      () => null,
    );
    if (!res?.ok) {
      setError("Could not load MCP access. Try refreshing.");
      return;
    }
    setData(await res.json());
    setError("");
  }, []);
  useEffect(() => {
    if (session?.user) void refresh();
    else setData(null);
  }, [session?.user, refresh]);

  async function request() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/mcp-access", { method: "POST" }).catch(
      () => null,
    );
    if (!res?.ok) setError("Could not request access. Please try again.");
    else await refresh();
    setBusy(false);
  }

  return (
    <section className="mt-8 rounded-2xl border border-border p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-serif text-xl text-foreground">
          Connect your research assistant
        </h2>
        {data?.isAdmin && (
          <Link href="/admin/mcp" className="text-sm text-accent underline">
            Manage MCP access
          </Link>
        )}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Let an MCP-compatible assistant find Singapore judgments, legislation,
        and supporting authorities, then open the exact source. Each connection
        uses one of your personal keys.
      </p>
      {isPending ? (
        <p className="mt-4 text-sm text-muted">Loading access…</p>
      ) : !session?.user ? (
        <Link
          href="/sign-in?next=%2Fdevelopers"
          className="mt-4 inline-block text-sm text-accent underline"
        >
          Sign in to request MCP access
        </Link>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-medium">
              {!data
                ? "Loading…"
                : !data.enabled
                  ? "Service paused"
                  : data.access?.status === "approved"
                    ? "Access approved"
                    : data.access?.status === "pending"
                      ? "Awaiting approval"
                      : data.access?.status === "suspended"
                        ? "Access suspended"
                        : "Access not requested"}
            </span>
            {data && !data.access && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void request()}
                className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-primary-fg disabled:opacity-50"
              >
                {busy ? "Requesting…" : "Request access"}
              </button>
            )}
            <button
              type="button"
              onClick={() => void refresh()}
              className="text-xs text-muted underline"
            >
              Refresh status
            </button>
          </div>
          {data?.access?.status === "approved" && (
            <p className="mt-3 text-xs text-muted">
              {data.access.canSearch ? "Search enabled" : "Search disabled"} ·{" "}
              {data.access.canRead
                ? "Source reading enabled"
                : "Source reading disabled"}{" "}
              · {data.access.requestsPerMinute} requests per minute across your
              keys.
            </p>
          )}
          {data?.access?.status === "pending" && (
            <p className="mt-3 text-xs text-muted">
              Your request is ready for review. MCP calls will work once access
              is approved and MCP is enabled on your key.
            </p>
          )}
          {data?.access?.status === "suspended" && (
            <p className="mt-3 text-xs text-muted">
              An administrator has suspended this account’s MCP access. Your
              existing MCP connections cannot make new calls.
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      <ol className="mt-5 list-decimal space-y-2 pl-5 text-sm text-muted">
        <li>Request access and wait for approval.</li>
        <li>
          Create a key below, copy it, and switch{" "}
          <strong className="font-medium text-foreground">MCP on</strong> for
          that key.
        </li>
        <li>
          Add{" "}
          <code className="text-xs text-foreground">
            https://lawplain.com/mcp
          </code>{" "}
          to your assistant as a Streamable HTTP server, using your key as a
          Bearer token.
        </li>
      </ol>
      <p className="mt-3 text-xs leading-relaxed text-muted-2">
        Your client must support custom Authorization headers. This connection
        uses a personal API key; a browser-based OAuth connection is not
        available yet.
      </p>
      <p className="mt-4 text-xs leading-relaxed text-muted-2">
        Lawplain records the account, key, tool, outcome, timing, and response
        size for 30 days. You and Lawplain administrators can see this activity.
        This log does not store search text, source contents, or your
        assistant’s conversation.
      </p>
      {data && (
        <details className="mt-6 border-t border-border pt-5">
          <summary className="mb-3 cursor-pointer text-sm font-medium">
            Your recent activity
            <span className="ml-2 text-xs font-normal text-muted">
              {data.summary.requests} requests · {data.summary.successful}{" "}
              successful · last 24 hours
            </span>
          </summary>
          <McpActivityTable activity={data.activity} />
          <p className="mt-2 text-xs text-muted-2">
            Latest 100 requests within the past 30 days.
          </p>
        </details>
      )}
    </section>
  );
}
