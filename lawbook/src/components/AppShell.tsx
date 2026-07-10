"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { AuthMenu } from "@/components/AuthMenu";
import { useChrome } from "@/components/chrome/ChromeContext";
import {
  BookIcon,
  HistoryIcon,
  SearchIcon,
  SparkleIcon,
} from "@/components/icons";
import {
  authClient,
  SIGN_OUT_TRANSITION_END,
  SIGN_OUT_TRANSITION_START,
  signOutWithTransition,
} from "@/lib/auth-client";

const NAV = [
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
  {
    href: "/recents",
    label: "Recents",
    icon: HistoryIcon,
    match: (p: string) => p.startsWith("/recents"),
  },
];

const EASE = "duration-500 ease-[var(--ease-emphasized)]";
const COLLAPSE_KEY = "lawplain:sidebar-collapsed";

/**
 * App chrome. Idle: a top header bar. As search becomes active the header
 * gracefully collapses and the same navigation slides in as a left sidebar
 * (shadcn-style), and the content shifts to make room. The desktop sidebar can
 * be collapsed to an icon rail (persisted); mobile is always a slim icon rail.
 */
export function AppShell({
  children,
  footer,
}: {
  children: ReactNode;
  footer: ReactNode;
}) {
  const {
    searchActive,
    hideFooter,
    askSidebarOpen,
    setAskSidebarOpen,
    askSidebarAvailable,
    askSidebarUnread,
    setAskSidebarUnread,
  } = useChrome();
  const pathname = usePathname();
  const askRoute = pathname.startsWith("/ask");
  const [collapsed, setCollapsed] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const sessionUserId = session?.user?.id;
  const visibleNav = NAV.filter(
    (tab) => tab.href !== "/ask" || Boolean(sessionUserId) || signingOut,
  );

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      // localStorage may be unavailable; keep the default.
    }
  }, []);

  useEffect(() => {
    let safetyTimer: number | undefined;
    const begin = () => {
      setSigningOut(true);
      if (safetyTimer !== undefined) window.clearTimeout(safetyTimer);
      safetyTimer = window.setTimeout(() => setSigningOut(false), 1200);
    };
    const end = () => setSigningOut(false);

    window.addEventListener(SIGN_OUT_TRANSITION_START, begin);
    window.addEventListener(SIGN_OUT_TRANSITION_END, end);
    return () => {
      window.removeEventListener(SIGN_OUT_TRANSITION_START, begin);
      window.removeEventListener(SIGN_OUT_TRANSITION_END, end);
      if (safetyTimer !== undefined) window.clearTimeout(safetyTimer);
    };
  }, []);

  useEffect(() => {
    void pathname;
    setSigningOut(false);
  }, [pathname]);

  useEffect(() => {
    // Recheck immediately after navigation as well as on the polling cadence.
    void pathname;
    if (sessionPending) return;
    if (!sessionUserId) {
      setAskSidebarUnread(false);
      return;
    }

    let cancelled = false;
    let timer: number | undefined;
    let refreshing = false;

    const refreshAskCompletion = async () => {
      if (cancelled || refreshing) return;
      refreshing = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
      let nextPollMs = 30_000;
      try {
        const response = await fetch("/api/ask-threads", {
          cache: "no-store",
        });
        if (!response.ok) return;
        const data = (await response.json()) as {
          threads?: Array<{ status?: string | null; unread?: boolean }>;
        };
        if (cancelled) return;
        const threads = data.threads ?? [];
        const hasRunningThread = threads.some(
          (thread) => thread.status === "running",
        );
        setAskSidebarUnread(
          threads.some(
            (thread) => thread.status === "done" && thread.unread === true,
          ),
        );
        if (hasRunningThread) nextPollMs = 5_000;
      } catch {
        // Keep the last known notification through transient network failures.
      } finally {
        refreshing = false;
        if (!cancelled) {
          timer = window.setTimeout(refreshAskCompletion, nextPollMs);
        }
      }
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshAskCompletion();
      }
    };

    window.addEventListener("focus", refreshWhenVisible);
    window.addEventListener("pageshow", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    void refreshAskCompletion();
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refreshWhenVisible);
      window.removeEventListener("pageshow", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [pathname, sessionUserId, sessionPending, setAskSidebarUnread]);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // ignore persistence failures
      }
      return next;
    });
  };

  // Label visibility: hidden on the mobile rail and on the collapsed desktop
  // rail; shown only when the desktop sidebar is expanded.
  const labelCls = collapsed ? "hidden" : "hidden lg:inline";
  const asideWidth = collapsed ? "w-16" : "w-16 lg:w-60";
  const contentPad = searchActive
    ? collapsed
      ? "pl-16"
      : "pl-16 lg:pl-60"
    : "";

  return (
    <>
      <header
        className={`sticky top-0 z-40 overflow-hidden bg-background/80 backdrop-blur-md transition-all ${EASE} ${
          searchActive
            ? "max-h-0 border-b border-transparent opacity-0"
            : "max-h-24 border-b border-border opacity-100"
        }`}
      >
        <div
          className={`flex h-14 w-full items-center justify-between px-5 sm:px-8 ${
            askRoute ? "" : "mx-auto max-w-6xl"
          }`}
        >
          <div className="flex items-center gap-1.5">
            {askRoute && askSidebarAvailable && (
              <button
                type="button"
                onClick={() => setAskSidebarOpen((open) => !open)}
                aria-label={askSidebarOpen ? "Close history" : "Open history"}
                aria-expanded={askSidebarOpen}
                className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-2 transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                {askSidebarUnread && !askSidebarOpen && (
                  <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-accent" />
                )}
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="h-5 w-5 translate-y-px"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <path d="M9 4v16" />
                </svg>
              </button>
            )}
            <Link href="/" className="flex items-center gap-2.5">
              <span className="font-serif text-lg font-medium leading-none tracking-tight text-foreground">
                Lawplain<span className="text-accent">.</span>
              </span>
            </Link>
          </div>
          <nav className="flex items-center gap-1">
            {visibleNav.map((tab) => {
              const active = tab.match(pathname);
              const Icon = tab.icon;
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-[color,background-color,opacity] duration-[50ms] ${
                    active
                      ? "bg-accent-soft text-accent"
                      : "text-muted-2 hover:bg-surface-2 hover:text-foreground"
                  } ${
                    tab.href === "/ask" && signingOut
                      ? "pointer-events-none opacity-0"
                      : "opacity-100"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{tab.label}</span>
                  {tab.href === "/ask" && askSidebarUnread && (
                    <span
                      title="Completed chat"
                      className="ml-0.5 h-2 w-2 shrink-0 rounded-full bg-accent"
                    >
                      <span className="sr-only">Completed chat</span>
                    </span>
                  )}
                </Link>
              );
            })}
            <AuthMenu />
          </nav>
        </div>
      </header>

      <aside
        aria-hidden={!searchActive}
        className={`fixed inset-y-0 left-0 z-50 flex flex-col border-r border-border bg-background transition-[transform,width] ${EASE} ${asideWidth} ${
          searchActive ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-14 items-center justify-between px-3 lg:px-4">
          <Link
            href="/"
            className="font-serif text-xl font-medium tracking-tight text-foreground"
          >
            <span className={collapsed ? "" : "lg:hidden"}>L</span>
            <span className={collapsed ? "hidden" : "hidden lg:inline"}>
              Lawplain
            </span>
            <span className="text-accent">.</span>
          </Link>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden rounded-md p-1.5 text-muted-2 transition-colors hover:bg-surface-2 hover:text-foreground lg:inline-flex"
          >
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
              className={`h-4 w-4 transition-transform ${collapsed ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10 3 5 8l5 5" />
            </svg>
          </button>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-2 py-2 lg:px-3">
          {visibleNav.map((tab) => {
            const active = tab.match(pathname);
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                title={tab.label}
                className={`relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-[color,background-color,opacity] duration-[50ms] ${
                  active
                    ? "bg-accent-soft text-accent"
                    : "text-muted-2 hover:bg-surface-2 hover:text-foreground"
                } ${
                  tab.href === "/ask" && signingOut
                    ? "pointer-events-none opacity-0"
                    : "opacity-100"
                }`}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span className={`truncate ${labelCls}`}>{tab.label}</span>
                {tab.href === "/ask" && askSidebarUnread && (
                  <span
                    title="Completed chat"
                    className={
                      collapsed
                        ? "absolute right-1 top-1 h-2 w-2 rounded-full bg-accent"
                        : "ml-auto hidden h-2 w-2 shrink-0 rounded-full bg-accent lg:inline-flex"
                    }
                  >
                    <span className="sr-only">Completed chat</span>
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border p-2 lg:p-3">
          <SidebarAuth labelCls={labelCls} />
        </div>
      </aside>

      <div
        className={`relative z-30 flex min-h-0 flex-1 flex-col bg-background transition-[padding,margin,border-radius] ${
          askRoute ? "duration-300 ease-[var(--ease-smooth-out)]" : EASE
        } ${contentPad} ${
          askRoute && askSidebarOpen ? "lg:ml-72 lg:rounded-l-2xl" : ""
        }`}
      >
        <div
          aria-hidden={signingOut || undefined}
          className={`flex min-h-0 flex-1 transition-opacity duration-[50ms] ${
            signingOut ? "pointer-events-none opacity-0" : "opacity-100"
          }`}
        >
          {children}
        </div>
        {!hideFooter && footer}
      </div>
    </>
  );
}

function SidebarAuth({ labelCls }: { labelCls: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [signingOut, setSigningOut] = useState(false);
  const next = encodeURIComponent(pathname || "/");

  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOutWithTransition(() => {
        router.replace("/");
        router.refresh();
      });
    } finally {
      setSigningOut(false);
    }
  };

  if (isPending) {
    return <div className="px-2.5 py-2 text-sm text-muted-2">…</div>;
  }

  if (!session?.user) {
    return (
      <div className="flex flex-col gap-1">
        <Link
          href={`/sign-in?next=${next}`}
          title="Sign in"
          className="flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium text-muted-2 transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <UserIcon className="h-5 w-5 shrink-0" />
          <span className={labelCls}>Sign in</span>
        </Link>
        <Link
          href={`/sign-up?next=${next}`}
          className={`rounded-lg bg-foreground px-2.5 py-2 text-center text-sm font-medium text-primary-fg transition-opacity hover:opacity-90 ${
            labelCls === "hidden" ? "hidden" : "hidden lg:block"
          }`}
        >
          Create account
        </Link>
      </div>
    );
  }

  const username =
    (session.user as { username?: string; name?: string }).username ??
    session.user.name;

  return (
    <div className="flex items-center justify-between gap-2">
      <span
        className={`min-w-0 truncate text-sm font-medium text-muted ${labelCls}`}
      >
        {username}
      </span>
      <button
        type="button"
        onClick={() => void signOut()}
        disabled={signingOut}
        aria-busy={signingOut}
        title="Sign out"
        className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-muted-2 transition-colors hover:bg-surface-2 hover:text-foreground"
      >
        <LogoutIcon className="h-5 w-5 shrink-0" />
        <span className={labelCls}>Sign out</span>
      </button>
    </div>
  );
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  );
}

function LogoutIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}
