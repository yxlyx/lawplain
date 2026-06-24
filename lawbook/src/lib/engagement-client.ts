/**
 * Browser-only engagement logging helpers.
 *
 * Privacy contract: anonymous and counter-only. We never log before the
 * visitor has acknowledged consent, never log if they opted out, and never
 * log when Do Not Track is set. Every helper is SSR-safe and returns a quiet
 * default when there is no `window`/`navigator`.
 */

const CONSENT_KEY = "lawplain.analytics.consent";

export type ClientDocType = "judgment" | "statute";

export interface ClientEngagementEvent {
  kind: "section_engage";
  docType: ClientDocType;
  docId: string;
  term: string;
  sectionId: string;
}

export type ConsentState = "unset" | "granted" | "optedout";

/** Whether the visitor has Do Not Track enabled (any of the vendor flags). */
export function isDntEnabled(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return false;
  }
  const nav = navigator as Navigator & { msDoNotTrack?: string };
  const win = window as Window & { doNotTrack?: string };
  return (
    nav.doNotTrack === "1" || win.doNotTrack === "1" || nav.msDoNotTrack === "1"
  );
}

/** Reads the stored consent decision; defaults to "unset". */
export function getConsentState(): ConsentState {
  if (typeof window === "undefined") return "unset";
  try {
    const value = window.localStorage.getItem(CONSENT_KEY);
    if (value === "granted" || value === "optedout") return value;
    return "unset";
  } catch {
    return "unset";
  }
}

/** Persists the visitor's consent decision. No-op during SSR. */
export function setConsentState(state: "granted" | "optedout"): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CONSENT_KEY, state);
  } catch {
    // Storage may be unavailable (private mode, quota); fail quietly.
  }
}

/** True only when not DNT and consent has been explicitly granted. */
export function canLog(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }
  return !isDntEnabled() && getConsentState() === "granted";
}

function sendEvent(ev: ClientEngagementEvent): void {
  try {
    const json = JSON.stringify(ev);
    if (typeof navigator.sendBeacon === "function") {
      const blob = new Blob([json], { type: "application/json" });
      if (navigator.sendBeacon("/api/events", blob)) return;
    }
    void fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: json,
      keepalive: true,
    }).catch(() => {
      // Swallow network errors; logging is best-effort.
    });
  } catch {
    // Never let logging break the page.
  }
}

/** Logs an engagement event. No-op unless `canLog()`. Never throws. */
export function logEngagement(ev: ClientEngagementEvent): void {
  if (!canLog()) return;
  sendEvent(ev);
}
