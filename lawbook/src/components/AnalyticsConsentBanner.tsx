"use client";

import { useAnalyticsConsent } from "@/hooks/useAnalyticsConsent";

export function AnalyticsConsentBanner() {
  const { showNotice, allow, optOut } = useAnalyticsConsent();
  if (!showNotice) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-3xl rounded-xl border border-border bg-surface/95 p-3 text-sm shadow-lg backdrop-blur sm:bottom-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
      <p className="text-muted">
        Lawplain can record anonymous, aggregate section engagement to highlight
        popular passages. No user IDs or profiles.
      </p>
      <div className="mt-3 flex shrink-0 gap-2 sm:mt-0">
        <button
          type="button"
          onClick={optOut}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
        >
          Opt out
        </button>
        <button
          type="button"
          onClick={allow}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-fg transition-opacity hover:opacity-90"
        >
          Allow
        </button>
      </div>
    </div>
  );
}
