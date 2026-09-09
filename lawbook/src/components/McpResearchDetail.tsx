"use client";

import { useState } from "react";
import type { McpResearch } from "@/server/mcp-store";

function pretty(text: string): string {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed) && parsed[0]?.content)
      return parsed
        .flatMap((result) =>
          result.content.map((block: { text?: string }) => {
            if (!block.text) return "";
            try {
              return JSON.stringify(JSON.parse(block.text), null, 2);
            } catch {
              return block.text;
            }
          }),
        )
        .join("\n\n");
    return JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
}

export function McpResearchDetail({
  id,
  canFeedback,
  rating: initialRating,
  initiallyOpen = false,
}: {
  initiallyOpen?: boolean;
  id: string;
  canFeedback: boolean;
  rating: McpResearch["rating"];
}) {
  const [data, setData] = useState<McpResearch | null>(null);
  const [rating, setRating] = useState<McpResearch["rating"]>(initialRating);
  const [comment, setComment] = useState("");
  const [sharedAnswer, setSharedAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  async function load() {
    if (data || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(
        `/api/mcp-activity?id=${encodeURIComponent(id)}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error();
      const { research } = (await res.json()) as { research: McpResearch };
      setData(research);
      setRating(research.rating);
      setComment(research.comment ?? "");
      setSharedAnswer(research.sharedAnswer ?? "");
    } catch {
      setError("Could not load this record. Close and reopen to retry.");
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/mcp-activity", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ activityId: id, rating, comment, sharedAnswer }),
      });
      if (!res.ok) throw new Error();
      if (!rating) {
        setComment("");
        setSharedAnswer("");
      }
      setNotice(rating ? "Feedback saved. Thank you." : "Feedback cleared.");
    } catch {
      setError("Feedback was not saved. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  const field =
    "mt-1 w-full rounded-lg border border-border bg-background p-2 text-sm";
  return (
    <details
      open={initiallyOpen}
      onToggle={(event) => {
        if (event.currentTarget.open) void load();
      }}
      className="min-w-40"
    >
      <summary className="cursor-pointer text-xs text-accent">
        View query & reply
        {rating ? ` · ${rating === "helpful" ? "Helpful" : "Not helpful"}` : ""}
      </summary>
      <div className="mt-3 min-w-0 space-y-3">
        {busy && !data && (
          <output className="block text-xs text-muted">Loading…</output>
        )}
        {data && (
          <>
            <p className="break-all text-xs text-muted">Request {id}</p>
            <p className="text-xs font-medium">Query / source request</p>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-3 text-xs">
              {pretty(data.requestText)}
            </pre>
            <p className="text-xs font-medium">Lawplain tool reply</p>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-3 text-xs">
              {pretty(data.replyText)}
            </pre>
            {Boolean(data.truncated) && (
              <p className="text-xs text-muted">
                Snapshot shortened for storage. The original tool reply may be
                longer.
              </p>
            )}
            {canFeedback ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}
                className="space-y-3 border-t border-border pt-3"
              >
                <label className="block text-xs">
                  Was this useful?
                  <select
                    value={rating ?? ""}
                    onChange={(event) => {
                      setRating(
                        (event.target.value || null) as McpResearch["rating"],
                      );
                      setNotice("");
                    }}
                    className={field}
                  >
                    <option value="">No rating / clear feedback</option>
                    <option value="helpful">Helpful</option>
                    <option value="not_helpful">Not helpful</option>
                  </select>
                </label>
                <label className="block text-xs">
                  What worked or needs improving? (optional)
                  <textarea
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    disabled={!rating}
                    maxLength={2000}
                    rows={3}
                    className={field}
                  />
                </label>
                <details>
                  <summary className="cursor-pointer text-xs text-muted">
                    Share your assistant’s final answer (optional)
                  </summary>
                  <p className="mt-2 text-xs text-muted">
                    Only paste an answer you want Lawplain administrators to
                    review. Leave out confidential client information.
                  </p>
                  <textarea
                    aria-label="Assistant answer to share with Lawplain"
                    value={sharedAnswer}
                    onChange={(event) => setSharedAnswer(event.target.value)}
                    disabled={!rating}
                    maxLength={12000}
                    rows={4}
                    className={field}
                  />
                </details>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-primary-fg disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Save feedback"}
                </button>
              </form>
            ) : (
              <div className="space-y-2 border-t border-border pt-3 text-xs">
                <p>
                  Feedback:{" "}
                  {data.rating?.replaceAll("_", " ") ?? "Not yet rated"}
                </p>
                {data.comment && (
                  <p className="whitespace-pre-wrap break-words">
                    {data.comment}
                  </p>
                )}
                {data.sharedAnswer && (
                  <>
                    <p className="font-medium">
                      Answer explicitly shared by the account
                    </p>
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words">
                      {data.sharedAnswer}
                    </pre>
                  </>
                )}
              </div>
            )}
          </>
        )}
        {notice && (
          <output className="block text-xs text-accent">{notice}</output>
        )}
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
