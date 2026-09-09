"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react";
import { useChrome } from "@/components/chrome/ChromeContext";
import { ResearchFolder } from "@/components/ResearchFolder";
import { SearchExplorer } from "@/components/SearchExplorer";
import { COLLECTIONS } from "@/lib/collections";

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
    <div
      className={`garden-home editorial-home ${active ? "is-searching" : ""}`}
    >
      {active && <h1 className="sr-only">Search Singapore law</h1>}
      <div className={`garden-opening ${active ? "is-active" : ""}`}>
        {!active && (
          <>
            <div className="garden-hero" aria-hidden="true">
              {/* Static responsive sources work on Workers without an image proxy. */}
              <picture>
                <source
                  media="(max-width: 650px)"
                  srcSet="/images/singapore-garden-mobile.webp"
                />
                <img
                  src="/images/singapore-garden-960.webp"
                  srcSet="/images/singapore-garden-640.webp 640w, /images/singapore-garden-960.webp 960w, /images/singapore-garden.webp 1680w"
                  sizes="(max-width: 850px) 40vw, (max-width: 1150px) 43vw, 470px"
                  alt=""
                  width={1680}
                  height={946}
                  fetchPriority="high"
                  className="garden-art"
                />
              </picture>
              <div className="garden-shade" />
            </div>
            <div className="garden-hero-copy">
              <p className="garden-eyebrow">
                <span /> Singapore legal research
              </p>
              <h1 id="garden-title">
                Research
                <br />
                Singapore law.
              </h1>
              <p>Search judgments, legislation and parliamentary debates.</p>
            </div>
          </>
        )}
        <section className="garden-search" aria-label="Search Singapore law">
          {!active && (
            <div className="garden-search-heading">
              <span>Find a case, Act or topic</span>
              <Link href="/faq">Search tips ↗</Link>
            </div>
          )}
          <SearchExplorer
            courts={courts}
            initialTab={initialTab}
            initialQuery={initialQuery}
            onActiveChange={setSearchActive}
          />
          {!active && (
            <div className="garden-search-alternative">
              <span>Or ask a question in plain English.</span>
              <Link href="/ask">
                Ask Lawplain <span aria-hidden="true">↗</span>
              </Link>
            </div>
          )}
        </section>
      </div>
      {!active && (
        <>
          {stats && <div className="garden-stats">{stats}</div>}
          <section
            className="garden-collections"
            aria-labelledby="collections-title"
          >
            <div className="garden-section-heading">
              <div>
                <h2 id="collections-title">Browse by source</h2>
              </div>
              <Link href="/research">
                All collections <span aria-hidden="true">↗</span>
              </Link>
            </div>
            <div className="garden-folder-grid">
              {COLLECTIONS.slice(0, 4).map((c, i) => (
                <Link
                  key={c.slug}
                  href={`/research/${c.slug}`}
                  className="garden-collection-card"
                >
                  <ResearchFolder tone={i} />
                  <h3>
                    {c.title} <span aria-hidden="true">↗</span>
                  </h3>
                  <p>{c.short}</p>
                </Link>
              ))}
            </div>
          </section>
          <section className="home-ask-row" aria-labelledby="home-ask-title">
            <div>
              <h2 id="home-ask-title">Ask Lawplain</h2>
              <p>
                Research a question and get an explanation with links to the
                sources.
              </p>
            </div>
            <Link href="/ask">
              Start a question <span aria-hidden="true">↗</span>
            </Link>
          </section>
          <section
            className="home-source-note"
            aria-labelledby="home-about-title"
          >
            <h2 id="home-about-title">About the collection</h2>
            <div>
              <p>
                Singapore judgments, statutes, parliamentary debates and
                official guidance, searchable in one place. Read the underlying
                documents and check the official source for the current text.
              </p>
              <nav aria-label="About Lawplain">
                <Link href="/faq">How to use Lawplain</Link>
                <Link href="/developers">API access</Link>
              </nav>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
