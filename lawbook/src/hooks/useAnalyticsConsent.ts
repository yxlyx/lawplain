"use client";

import { useEffect, useState } from "react";

export type AnalyticsConsent = "unknown" | "allowed" | "opted_out" | "dnt";

const KEY = "lawplain.analyticsConsent";

function hasDnt(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined")
    return false;
  const nav = navigator as Navigator & {
    msDoNotTrack?: string;
    doNotTrack?: string;
  };
  const win = window as Window & { doNotTrack?: string };
  return (
    nav.doNotTrack === "1" || nav.msDoNotTrack === "1" || win.doNotTrack === "1"
  );
}

function readConsent(): AnalyticsConsent {
  if (typeof window === "undefined") return "unknown";
  if (hasDnt()) return "dnt";
  const stored = window.localStorage.getItem(KEY);
  return stored === "allowed" || stored === "opted_out" ? stored : "unknown";
}

export function useAnalyticsConsent() {
  const [consent, setConsent] = useState<AnalyticsConsent>("unknown");

  useEffect(() => {
    setConsent(readConsent());
  }, []);

  const allow = () => {
    window.localStorage.setItem(KEY, "allowed");
    setConsent(readConsent());
  };

  const optOut = () => {
    window.localStorage.setItem(KEY, "opted_out");
    setConsent(readConsent());
  };

  return {
    consent,
    canSend: consent === "allowed",
    showNotice: consent === "unknown",
    allow,
    optOut,
  };
}
