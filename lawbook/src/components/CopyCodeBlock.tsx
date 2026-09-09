"use client";

import { useState } from "react";

export function CopyCodeBlock({ text }: { text: string }) {
  const [status, setStatus] = useState("Copy");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copied");
    } catch {
      setStatus("Select and copy manually");
    }
  }
  return (
    <div className="my-4 overflow-hidden rounded-xl border border-border bg-surface-2/50">
      <div className="flex justify-end border-b border-border px-3 py-2">
        <button
          type="button"
          onClick={copy}
          className="text-xs text-muted hover:text-foreground"
          aria-live="polite"
        >
          {status}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed">
        <code>{text}</code>
      </pre>
    </div>
  );
}
