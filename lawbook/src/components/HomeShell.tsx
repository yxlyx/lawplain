"use client";

import Image from "next/image";
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
    <div className={`garden-home ${active ? "is-searching" : ""}`}>
      {active && <h1 className="sr-only">Search Singapore law</h1>}
      <div className={`garden-opening ${active ? "is-active" : ""}`}>
        {!active && (
          <>
            <div className="garden-hero" aria-hidden="true">
              <Image
                src="/images/singapore-garden.webp"
                alt=""
                fill
                unoptimized
                preload
                sizes="(max-width: 1440px) 100vw, 1440px"
                className="garden-art"
              />
              <div className="garden-shade" />
            </div>
            <div className="garden-hero-copy">
              <p className="garden-eyebrow">
                <span /> SINGAPORE LAW, OPEN TO EVERYONE
              </p>
              <h1 id="garden-title">
                A little clarity.
                <br />A world of <em>law.</em>
              </h1>
              <p>
                Find the law. Understand the context.
                <br />
                Go straight to the source.
              </p>
            </div>
          </>
        )}
        <section className="garden-search" aria-label="Search Singapore law">
          {!active && (
            <div className="garden-search-heading">
              <span>Search Singapore law</span>
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
              <span>Have a question instead?</span>
              <Link href="/ask">
                Ask Lawplain <span aria-hidden="true">↗</span>
              </Link>
            </div>
          )}
        </section>
        {!active && (
          <span className="garden-location" aria-hidden="true">
            SINGAPORE · A DIFFERENT VIEW OF THE LAW
          </span>
        )}
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
                <p className="garden-kicker">THE RESEARCH SHELF</p>
                <h2 id="collections-title">Good questions start here.</h2>
              </div>
              <Link href="/research">
                Explore the library <span aria-hidden="true">↗</span>
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
                  <span className="garden-card-index">
                    0{i + 1} / COLLECTION
                  </span>
                  <h3>
                    {c.title} <span aria-hidden="true">↗</span>
                  </h3>
                  <p>{c.short}</p>
                </Link>
              ))}
            </div>
          </section>
          <section className="garden-ask-feature">
            <div>
              <p className="garden-kicker">MEET YOUR RESEARCH COMPANION</p>
              <h2>
                Big question?
                <br />
                <em>Start in plain English.</em>
              </h2>
              <p>
                Ask Lawplain searches the legal corpus and brings the findings
                together in a cited answer. Read the explanation, follow the
                sources, and keep exploring.
              </p>
              <Link href="/ask" className="garden-cta">
                Ask Lawplain <span aria-hidden="true">↗</span>
              </Link>
            </div>
            <div className="garden-example">
              <span className="garden-example-label">A PLACE TO BEGIN</span>
              <p>
                “What must a plaintiff prove
                <br />
                in a defamation claim?”
              </p>
              <div>
                <span className="garden-source-dot" /> Search judgments{" "}
                <span>→</span> Read sources <span>→</span> Find clarity
              </div>
              <span className="garden-example-footnote">
                Legal information, with a trail back to the source.
              </span>
            </div>
          </section>
          <section className="garden-about">
            <p className="garden-kicker">BUILT FOR UNDERSTANDING</p>
            <h2>
              Singapore legal research.
              <br />A clearer place to start.
            </h2>
            <p>
              Explore Singapore judgments, statutes, parliamentary debates,
              bills, practice directions, and official agency guidance in one
              place. Search the full text, read the underlying documents, and
              save useful passages to return to later.
            </p>
            <p>
              Lawplain provides legal information, not legal advice. Always
              check the official source for the current text and seek a
              qualified lawyer for advice on your circumstances.
            </p>
            <div>
              <Link href="/faq">How Lawplain works ↗</Link>
              <Link href="/developers">Build with the API ↗</Link>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
