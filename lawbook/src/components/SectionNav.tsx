"use client";

import type { MouseEvent } from "react";

export interface SectionNavItem {
  id: string;
  label: string;
  count?: number;
  badge?: string;
}

export function SectionNav({
  items,
  title = "Sections",
}: {
  items: SectionNavItem[];
  title?: string;
}) {
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
      className="rounded-xl border border-border bg-surface p-4 lg:sticky lg:top-20 lg:p-3"
    >
      <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-2">
        {title}
      </h2>
      <ul className="flex gap-1.5 overflow-x-auto pb-1 lg:max-h-[70vh] lg:flex-col lg:gap-0.5 lg:overflow-x-visible lg:overflow-y-auto lg:pb-0">
        {items.map((item) => (
          <li key={item.id} className="shrink-0 lg:shrink">
            <a
              href={`#${item.id}`}
              onClick={(e) => handleClick(e, item.id)}
              className="flex max-w-[12rem] flex-col items-start rounded-md px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-foreground lg:max-w-[14rem]"
            >
              <span className="block max-w-full truncate leading-4">
                {item.label}
              </span>
              {item.badge && (
                <span className="-ml-1.5 mt-0.5 block max-w-[calc(100%+0.75rem)] truncate rounded-full bg-accent-soft px-1.5 py-px text-[10px] font-medium leading-3 text-accent">
                  {item.badge}
                </span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
