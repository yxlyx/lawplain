"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AuthMenu } from "@/components/AuthMenu";
import { BookIcon, SearchIcon, SparkleIcon } from "@/components/icons";

const TABS = [
  {
    href: "/",
    label: "Search",
    icon: SearchIcon,
    match: (p: string) => p === "/",
  },
  {
    href: "/ask",
    label: "Ask Lawplain",
    icon: SparkleIcon,
    match: (p: string) => p.startsWith("/ask"),
  },
  {
    href: "/saved",
    label: "Saved",
    icon: BookIcon,
    match: (p: string) => p.startsWith("/saved"),
  },
];

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-3 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="font-serif text-lg font-medium tracking-tight text-foreground">
            Lawplain<span className="text-accent">.</span>
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          {TABS.map((tab) => {
            const active = tab.match(pathname);
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-accent-soft text-accent"
                    : "text-muted-2 hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </Link>
            );
          })}
          <AuthMenu />
        </nav>
      </div>
    </header>
  );
}
