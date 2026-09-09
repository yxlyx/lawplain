"use client";

import { useState } from "react";

export function CopyForLlms({ text }: { text: string }) {
  const [status, setStatus] = useState("");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Full guide copied");
    } catch {
      setStatus(
        "Copy unavailable. Open llms.txt to select and copy the guide.",
      );
    }
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button
          type="button"
          onClick={copy}
          className="rounded-lg border border-border px-4 py-2 transition-colors hover:bg-surface-2"
        >
          Copy for LLMs
        </button>
        <a
          href="/developers/mcp/llms.txt"
          className="text-muted underline underline-offset-4 hover:text-foreground"
        >
          Open llms.txt ↗
        </a>
      </div>
      <output className="mt-2 block text-xs leading-relaxed text-muted-2">
        {status ||
          "Copy this entire guide as Markdown, ready to paste into your agent."}
      </output>
    </div>
  );
}
