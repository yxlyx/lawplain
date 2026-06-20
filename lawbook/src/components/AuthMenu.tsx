"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function AuthMenu() {
  const pathname = usePathname();
  const { data: session, isPending } = authClient.useSession();
  const next = encodeURIComponent(pathname || "/");
  const username = session?.user
    ? ((session.user as { username?: string; name?: string }).username ??
      session.user.name)
    : null;

  if (isPending) {
    return (
      <span className="ml-2 hidden rounded-lg px-3 py-1.5 text-sm text-muted-2 sm:inline-flex">
        …
      </span>
    );
  }

  if (!session?.user) {
    return (
      <div className="ml-2 flex items-center gap-1 border-l border-border pl-2">
        <Link
          href={`/sign-in?next=${next}`}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-2 transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          Sign in
        </Link>
        <Link
          href={`/sign-up?next=${next}`}
          className="rounded-lg bg-foreground px-3 py-1.5 text-sm font-medium text-primary-fg transition-opacity hover:opacity-90"
        >
          Create account
        </Link>
      </div>
    );
  }

  return (
    <div className="ml-2 flex items-center gap-2 border-l border-border pl-2">
      <span className="hidden max-w-32 truncate rounded-lg bg-surface-2 px-3 py-1.5 text-sm font-medium text-muted sm:inline-block">
        {username}
      </span>
      <button
        type="button"
        onClick={() => void authClient.signOut()}
        className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-2 transition-colors hover:bg-surface-2 hover:text-foreground"
      >
        Sign out
      </button>
    </div>
  );
}
