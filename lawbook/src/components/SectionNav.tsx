"use client";

import type { MouseEvent } from "react";
import { useActiveSection } from "@/hooks/useActiveSection";

export interface SectionNavItem {
  id: string; // target element id (without '#')
  label: string; // visible label
  count?: number;
  badge?: string;
}

/**
 * Section navigation rail shared by judgments and statutes: a sticky vertical
 * list on desktop, a horizontal scrollable chip row on mobile. Highlights the
 * section currently in view via IntersectionObserver. No network dependency.
 */
export function SectionNav({
  items,
  title = "Sections",
  className = "",
  activeId,
}: {
  items: SectionNavItem[];
  title?: string;
  className?: string;
  activeId?: string | null;
}) {
  const ids = items.map((i) => i.id);
  const observedActive = useActiveSection(ids);
  const active = activeId ?? observedActive;

  if (items.length < 2) return null;

  const handleClick = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    history.replaceState(null, "", `#${id}`);
  };

  return (
    <nav
      aria-label={title}
      className={`rounded-xl border border-border bg-surface p-4 sm:sticky sm:top-20 sm:p-3 ${className}`}
    >
      <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-2">
        {title}
      </h2>
      <ul className="flex gap-1.5 overflow-x-auto pb-1 sm:max-h-[70vh] sm:flex-col sm:gap-0.5 sm:overflow-x-visible sm:overflow-y-auto sm:pb-0">
        {items.map((item) => {
          const isActive = item.id === active;
          return (
            <li key={item.id} className="shrink-0 sm:shrink">
              <a
                href={`#${item.id}`}
                onClick={(e) => handleClick(e, item.id)}
                aria-current={isActive ? "true" : undefined}
                className={`block rounded-md px-2.5 py-1.5 text-xs transition-colors sm:max-w-[14rem] ${
                  isActive
                    ? "bg-accent-soft font-medium text-accent"
                    : "text-muted hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                <span className="block truncate">{item.label}</span>
                {(item.badge || item.count !== undefined) && (
                  <span className="mt-1 flex items-center gap-1.5 text-[10px] leading-none text-muted-2">
                    {item.badge && (
                      <span className="rounded-full bg-accent-soft px-1.5 py-0.5 font-medium text-accent">
                        {item.badge}
                      </span>
                    )}
                    {item.count !== undefined && (
                      <span className="tabular-nums">{item.count}</span>
                    )}
                  </span>
                )}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
