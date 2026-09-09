"use client";

import { useCallback, useEffect, useState } from "react";
import type { McpAccess, McpActivity } from "@/server/mcp-store";
import { McpActivityTable } from "./McpActivityTable";

interface Account extends McpAccess {
  name: string;
  email: string;
  enabledKeys: number;
}
interface Dashboard {
  enabled: boolean;
  users: Account[];
  hasMore: boolean;
  activity: McpActivity[];
  summary: {
    requests: number;
    successful: number;
    responseBytes: number;
    averageMs: number;
  };
  audit: {
    id: string;
    actor: string;
    targetUserId: string | null;
    action: string;
    settingsJson: string;
    createdAt: number;
  }[];
}
const control =
  "rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-50";

function describeChange(json: string): string {
  try {
    const settings = JSON.parse(json);
    if (typeof settings.enabled === "boolean")
      return settings.enabled ? "MCP resumed" : "MCP paused";
    return `Access ${settings.status} · Search ${settings.canSearch ? "on" : "off"} · Source reading ${settings.canRead ? "on" : "off"} · ${settings.requestsPerMinute} requests/min`;
  } catch {
    return "Settings updated";
  }
}

function AccountControls({
  account,
  save,
  busy,
}: {
  account: Account;
  save: (body: Record<string, unknown>) => Promise<void>;
  busy: boolean;
}) {
  const [search, setSearch] = useState(Boolean(account.canSearch));
  const [read, setRead] = useState(Boolean(account.canRead));
  const [limit, setLimit] = useState(account.requestsPerMinute);
  useEffect(() => {
    setSearch(Boolean(account.canSearch));
    setRead(Boolean(account.canRead));
    setLimit(account.requestsPerMinute);
  }, [account.canSearch, account.canRead, account.requestsPerMinute]);
  const update = (status: string) =>
    save({
      action: "access",
      userId: account.userId,
      status,
      canSearch: search,
      canRead: read,
      requestsPerMinute: limit,
    });
  const invalid = !Number.isInteger(limit) || limit < 1 || limit > 600;
  return (
    <li className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-foreground">{account.name}</p>
          <p className="break-all text-sm text-muted">{account.email}</p>
          <p className="mt-1 text-xs text-muted-2">
            {account.enabledKeys} enabled keys · requested{" "}
            {new Date(account.requestedAt).toLocaleDateString()}
          </p>
        </div>
        <span className="rounded-full bg-surface-2 px-3 py-1 text-xs capitalize">
          {account.status}
        </span>
      </div>
      <fieldset
        disabled={busy}
        className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3"
      >
        <legend className="sr-only">MCP permissions for {account.email}</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={search}
            onChange={(e) => setSearch(e.target.checked)}
            className="accent-accent"
          />
          Search sources
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={read}
            onChange={(e) => setRead(e.target.checked)}
            className="accent-accent"
          />
          Read sources
        </label>
        <label className="flex items-center gap-2 text-sm">
          Requests/min
          <input
            aria-label={`Requests per minute for ${account.email}`}
            type="number"
            min={1}
            max={600}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className={`${control} w-20`}
          />
        </label>
      </fieldset>
      <div className="mt-4 flex flex-wrap gap-2">
        {account.status !== "approved" && (
          <button
            type="button"
            disabled={busy || invalid}
            onClick={() => void update("approved")}
            className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-primary-fg disabled:opacity-50"
          >
            Approve access
          </button>
        )}
        {account.status === "approved" && (
          <button
            type="button"
            disabled={busy || invalid}
            onClick={() => void update("approved")}
            className={control}
          >
            Save permissions
          </button>
        )}
        {account.status !== "suspended" && (
          <button
            type="button"
            disabled={busy || invalid}
            onClick={() => void update("suspended")}
            className={`${control} text-danger`}
          >
            Suspend access
          </button>
        )}
      </div>
    </li>
  );
}

export function McpAdminDashboard() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState(0);
  const [userId, setUserId] = useState("");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const params = new URLSearchParams({ offset: String(offset) });
    if (userId) params.set("userId", userId);
    const res = await fetch(`/api/admin/mcp?${params}`, {
      cache: "no-store",
    }).catch(() => null);
    if (!res?.ok) {
      setError(
        "Could not load the MCP dashboard. Check your session and try again.",
      );
      return;
    }
    setData(await res.json());
    setUpdatedAt(Date.now());
    setError("");
  }, [offset, userId]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15_000);
    return () => clearInterval(timer);
  }, [refresh]);

  async function save(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    const res = await fetch("/api/admin/mcp", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!res?.ok) setError("The change was not saved. Refresh and try again.");
    else {
      setNotice("Saved. New requests use the updated permissions.");
      await refresh();
    }
    setBusy(false);
  }

  const users = Object.fromEntries(
    (data?.users ?? []).map((user) => [user.userId, user.email]),
  );
  return (
    <div className="mt-7 space-y-8">
      <div aria-live="polite">
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        {notice && <p className="text-sm text-accent">{notice}</p>}
      </div>
      {!data ? (
        <p className="text-sm text-muted">Loading MCP controls…</p>
      ) : (
        <>
          <section className="flex flex-wrap items-center justify-between gap-5 rounded-2xl border border-border p-5">
            <div>
              <h2 className="font-medium">
                MCP is {data.enabled ? "available" : "paused"}
              </h2>
              <p className="mt-1 text-sm text-muted">
                {data.enabled
                  ? "Approved accounts with enabled keys can make requests."
                  : "All new MCP requests are blocked, including approved accounts."}
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void save({ action: "service", enabled: !data.enabled })
              }
              className={control}
            >
              {data.enabled ? "Pause MCP" : "Resume MCP"}
            </button>
          </section>
          <section
            aria-label="MCP usage in the last 24 hours"
            className="grid grid-cols-2 gap-3 sm:grid-cols-4"
          >
            {[
              ["Requests", data.summary.requests],
              ["Successful", data.summary.successful],
              ["Average time", `${data.summary.averageMs} ms`],
              [
                "Data returned",
                `${(data.summary.responseBytes / 1024).toFixed(1)} KB`,
              ],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-border p-4">
                <p className="text-xs text-muted">{label}</p>
                <p className="mt-2 text-2xl font-medium tabular-nums">
                  {value}
                </p>
                <p className="mt-1 text-xs text-muted-2">
                  Last 24 hours{userId ? " · selected account" : ""}
                </p>
              </div>
            ))}
          </section>
          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-serif text-xl">Accounts & permissions</h2>
              <span className="text-xs text-muted">
                Pending requests appear first
              </span>
            </div>
            {data.users.length ? (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {data.users.map((account) => (
                  <AccountControls
                    key={account.userId}
                    account={account}
                    save={save}
                    busy={busy}
                  />
                ))}
              </ul>
            ) : (
              <p className="rounded-xl border border-border p-6 text-sm text-muted">
                No access requests yet. Users can request access from the
                Developers page.
              </p>
            )}
            <div className="mt-3 flex items-center justify-end gap-3">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - 50))}
                className={control}
              >
                Previous
              </button>
              <span className="text-xs text-muted">Page {offset / 50 + 1}</span>
              <button
                type="button"
                disabled={!data.hasMore}
                onClick={() => setOffset(offset + 50)}
                className={control}
              >
                Next
              </button>
            </div>
          </section>
          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-serif text-xl">Recent activity</h2>
              <div className="flex flex-wrap gap-2">
                <select
                  aria-label="Filter MCP activity by account"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  className={`${control} max-w-64`}
                >
                  <option value="">All accounts</option>
                  {data.users.map((user) => (
                    <option key={user.userId} value={user.userId}>
                      {user.email}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void refresh()}
                  className={control}
                >
                  Refresh
                </button>
              </div>
            </div>
            <McpActivityTable activity={data.activity} users={users} />
            <p className="mt-3 text-xs leading-relaxed text-muted-2">
              Latest 100 requests in the past 30 days. Refreshes every 15
              seconds while this page is visible.
              {updatedAt
                ? ` Updated ${new Date(updatedAt).toLocaleTimeString()}.`
                : ""}{" "}
              Only calls to Lawplain are visible. Search text, returned
              documents, and external assistant conversations are not logged.
            </p>
          </section>
          <section>
            <h2 className="mb-3 font-serif text-xl">Permission changes</h2>
            {data.audit.length ? (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {data.audit.map((entry) => (
                  <li key={entry.id} className="p-4 text-sm">
                    <p>
                      <span className="font-medium">{entry.actor}</span>{" "}
                      {entry.action === "service_updated"
                        ? "changed service availability"
                        : `updated ${users[entry.targetUserId ?? ""] ?? entry.targetUserId}`}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      {new Date(entry.createdAt).toLocaleString()}
                    </p>
                    <p className="mt-2 break-words font-mono text-xs text-muted">
                      {describeChange(entry.settingsJson)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No permission changes yet.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
