"use client";

import { useEffect, useState } from "react";

/**
 * Tracks which section anchor is currently in view via IntersectionObserver.
 * `ids` is the ordered list of element ids to observe. Returns the active id.
 */
export function useActiveSection(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(ids[0] ?? null);
  const key = ids.join("|");

  // `key` is the serialised form of `ids`; observing it covers id changes
  // (e.g. judgment "load more" appends) without re-running on array identity.
  useEffect(() => {
    const ids = key ? key.split("|") : [];
    if (ids.length === 0) return;

    const visible = new Set<string>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        // First id in document order that is currently visible.
        const first = ids.find((id) => visible.has(id));
        if (first) setActive(first);
      },
      {
        // Activate when a heading crosses the band just below the sticky header.
        rootMargin: "-96px 0px -70% 0px",
        threshold: 0,
      },
    );

    const els = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    for (const el of els) observer.observe(el);

    return () => observer.disconnect();
  }, [key]);

  return active;
}
