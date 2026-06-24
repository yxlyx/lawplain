"use client";

import { type JSX, useEffect, useState } from "react";
import {
  getConsentState,
  isDntEnabled,
  setConsentState,
} from "@/lib/engagement-client";

/**
 * Slim bottom banner asking for anonymous, aggregate usage consent. It starts
 * hidden and only reveals itself after mount (avoiding hydration mismatch), and
 * only when consent is still unset and Do Not Track is off.
 */
export function AnalyticsConsent(): JSX.Element | null {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (getConsentState() === "unset" && !isDntEnabled()) {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const decide = (state: "granted" | "optedout") => {
    setConsentState(state);
    setVisible(false);
  };

  return (
    <div className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-3xl overflow-hidden rounded-2xl border border-border bg-surface/95 text-sm shadow-2xl backdrop-blur sm:bottom-5">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
              Privacy-first mode
            </span>
            <span className="text-xs text-muted">
              Anonymous · aggregate · no profiles
            </span>
          </div>
          <p className="font-medium text-foreground">
            Help improve legal search with anonymous section signals?
          </p>
          <p className="max-w-2xl text-muted">
            If you allow, we count which passages are useful for searches. No
            personal data, account IDs, cookies, or fingerprints.
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={() => decide("granted")}
            className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-fg transition-opacity hover:opacity-90"
          >
            Yes, improve search
          </button>
          <button
            type="button"
            onClick={() => decide("optedout")}
            className="rounded-full border border-border px-4 py-2 text-sm font-medium text-muted transition-colors hover:border-foreground/30 hover:text-foreground"
          >
            No thanks
          </button>
        </div>
      </div>
    </div>
  );
}
