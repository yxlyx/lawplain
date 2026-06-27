"use client";

import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react";
import { useChrome } from "@/components/chrome/ChromeContext";
import { SearchExplorer } from "@/components/SearchExplorer";

// useLayoutEffect on the client, useEffect on the server (avoids the SSR warning).
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Google-style home: the brand + search sit vertically centered when idle, and
 * smoothly rise to the top once a search is active (giving results room), while
 * the global chrome morphs from top header to left sidebar. Search-active state
 * is shared via ChromeContext so the hero and the chrome animate together.
 * Mobile-safe: viewport-relative spacer and responsive type sizes.
 */
export function HomeShell({
  courts,
  initialTab,
  initialQuery,
  stats,
}: {
  courts: string[];
  initialTab: string;
  initialQuery: string;
  stats?: ReactNode;
}) {
  const { searchActive, setSearchActive } = useChrome();
  const ease = "duration-500 ease-[var(--ease-emphasized)]";
  const initialActive = initialQuery.trim().length > 0;
  const firstRender = useRef(true);
  // First paint already reflects the URL query, so returning to a search (Back
  // from a document) renders collapsed with no big-hero flash. Later renders
  // follow the live state, so clearing the box still re-expands the hero.
  const active = firstRender.current
    ? searchActive || initialActive
    : searchActive;

  // Leaving the home page (e.g. opening a result) must restore the top header.
  useEffect(() => () => setSearchActive(false), [setSearchActive]);

  // Commit the real state before the first paint (drives the sidebar too).
  useIsoLayoutEffect(() => {
    firstRender.current = false;
    setSearchActive(initialActive);
  }, [initialActive, setSearchActive]);

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col">
      {/* Spacer collapses on search, lifting the hero upward. */}
      <div
        aria-hidden="true"
        className={`shrink-0 transition-[height] ${ease} ${
          active ? "h-4" : "h-[12vh] sm:h-[20vh]"
        }`}
      />

      {/* Hero brand. On search it collapses away entirely — the sidebar/header
          already shows "Lawplain.", so we avoid a duplicate. */}
      <div
        aria-hidden={active}
        className={`overflow-hidden text-center transition-all ${ease} ${
          active ? "mb-0 max-h-0 opacity-0" : "mb-6 max-h-44 opacity-100"
        }`}
      >
        <h1 className="font-serif text-5xl font-medium tracking-tight text-foreground sm:text-7xl">
          Lawplain<span className="text-accent">.</span>
        </h1>
        <p className="mt-3 text-sm font-semibold tracking-tight text-muted sm:text-base">
          Search Singapore judgments, statutes, Hansard &amp; more
        </p>
      </div>

      <SearchExplorer
        courts={courts}
        initialTab={initialTab}
        initialQuery={initialQuery}
        onActiveChange={setSearchActive}
      />

      {stats && (
        <div
          className={`transition-all ${ease} ${
            active ? "max-h-0 overflow-hidden opacity-0" : "mt-4 opacity-100"
          }`}
        >
          {stats}
        </div>
      )}
    </div>
  );
}
