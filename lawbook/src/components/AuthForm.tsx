"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  BookIcon,
  CheckIcon,
  SearchIcon,
  SparkleIcon,
} from "@/components/icons";
import { authClient } from "@/lib/auth-client";

type AuthFormProps = {
  mode: "sign-in" | "sign-up";
};

type AuthErrorState =
  | { kind: "text"; message: string }
  | { kind: "registered"; username: string }
  | { kind: "check-failed"; username: string }
  | { kind: "unregistered"; username: string };

const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 30;
const USERNAME_PATTERN = /^[a-zA-Z0-9_.]+$/;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

function accountEmail(username: string): string {
  return `${username.trim().toLowerCase()}@users.lawplain.local`;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object") {
    if ("message" in error && typeof error.message === "string") {
      return error.message;
    }
    if ("statusText" in error && typeof error.statusText === "string") {
      return error.statusText;
    }
  }
  return fallback;
}

function errorCode(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error) {
    return typeof error.code === "string" ? error.code : null;
  }
  return null;
}

function errorStrings(error: unknown, seen = new Set<unknown>()): string[] {
  if (typeof error === "string") return [error];
  if (!error || typeof error !== "object" || seen.has(error)) return [];
  seen.add(error);

  return Object.entries(error as Record<string, unknown>).flatMap(
    ([key, value]) => {
      if (["code", "message", "statusText", "error"].includes(key)) {
        return typeof value === "string" ? [value] : errorStrings(value, seen);
      }
      if (["body", "response", "data", "cause"].includes(key)) {
        return errorStrings(value, seen);
      }
      return [];
    },
  );
}

function isDuplicateAccountError(error: unknown): boolean {
  const code = errorCode(error);
  const details = errorStrings(error).join(" ");
  return (
    code === "USERNAME_IS_ALREADY_TAKEN" ||
    code === "USER_ALREADY_EXISTS" ||
    code === "EMAIL_ALREADY_EXISTS" ||
    code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" ||
    /username.*(taken|exists|use)/i.test(details) ||
    /(user|email|account).*(already exists|already in use)/i.test(details) ||
    /unique constraint/i.test(details)
  );
}

function usernameRequirementError(value: string): string | null {
  if (
    value.length < USERNAME_MIN_LENGTH ||
    value.length > USERNAME_MAX_LENGTH
  ) {
    return `Username must be between ${USERNAME_MIN_LENGTH} and ${USERNAME_MAX_LENGTH} characters.`;
  }
  if (!USERNAME_PATTERN.test(value)) {
    return "Username can only contain letters, numbers, underscores, and periods.";
  }
  return null;
}

function passwordRequirementError(value: string): string | null {
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (value.length > PASSWORD_MAX_LENGTH) {
    return `Password must be ${PASSWORD_MAX_LENGTH} characters or fewer.`;
  }
  return null;
}

function isInternalServerError(message: string): boolean {
  return /internal server error/i.test(message);
}

async function accountExists(username: string): Promise<boolean | null> {
  try {
    const response = await fetch(
      `/api/account-exists?username=${encodeURIComponent(username)}`,
      { cache: "no-store" },
    );
    if (!response.ok) return null;

    const result = (await response.json()) as { exists?: unknown };
    return result.exists === true;
  } catch {
    return null;
  }
}

function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  if (
    [...value].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  )
    return "/";
  return value;
}

function SuccessDestination({
  href,
  icon,
  title,
  description,
  last = false,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  last?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group flex min-h-20 items-center gap-4 py-3 transition-colors hover:text-accent ${
        last ? "" : "border-b border-border"
      }`}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted transition-colors group-hover:bg-accent-soft group-hover:text-accent">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">
          {title}
        </span>
        <span className="mt-0.5 block text-xs leading-5 text-muted">
          {description}
        </span>
      </span>
      <span
        aria-hidden="true"
        className="text-lg text-muted-2 transition-transform group-hover:translate-x-1 group-hover:text-accent"
      >
        →
      </span>
    </Link>
  );
}

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get("next"));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<AuthErrorState | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [authenticatedUsername, setAuthenticatedUsername] = useState<
    string | null
  >(null);

  const isSignUp = mode === "sign-up";

  async function onGoogleSignIn() {
    setError(null);
    setGoogleLoading(true);

    try {
      const { error } = await authClient.signIn.social({
        provider: "google",
        callbackURL: new URL(next, window.location.origin).toString(),
      });
      if (error) throw error;
    } catch (err) {
      setError({
        kind: "text",
        message: errorMessage(
          err,
          "Google sign-in failed. Please try again or use your username.",
        ),
      });
      setGoogleLoading(false);
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanUsername = username.trim();
    setError(null);

    if (!cleanUsername || !password) {
      setError({ kind: "text", message: "Enter a username and password." });
      return;
    }

    if (isSignUp && password !== confirmPassword) {
      setError({ kind: "text", message: "Passwords do not match." });
      return;
    }

    if (isSignUp) {
      const usernameError = usernameRequirementError(cleanUsername);
      if (usernameError) {
        setError({ kind: "text", message: usernameError });
        return;
      }

      const passwordError = passwordRequirementError(password);
      if (passwordError) {
        setError({ kind: "text", message: passwordError });
        return;
      }
    }

    let usernameCheckFailed = false;

    setLoading(true);
    try {
      if (isSignUp) {
        const exists = await accountExists(cleanUsername);
        if (exists === true) {
          setError({ kind: "registered", username: cleanUsername });
          return;
        }
        usernameCheckFailed = exists === null;

        const { error } = await authClient.signUp.email({
          name: cleanUsername,
          email: accountEmail(cleanUsername),
          password,
          username: cleanUsername,
          displayUsername: cleanUsername,
        });
        if (error) {
          if (isDuplicateAccountError(error)) {
            setError({ kind: "registered", username: cleanUsername });
            return;
          }
          throw error;
        }

        setPassword("");
        setConfirmPassword("");
        setAuthenticatedUsername(cleanUsername);
        router.refresh();
        return;
      } else {
        const exists = await accountExists(cleanUsername);
        if (exists === false) {
          setError({ kind: "unregistered", username: cleanUsername });
          return;
        }

        const { error } = await authClient.signIn.username({
          username: cleanUsername,
          password,
        });
        if (error) {
          const message = errorMessage(error, "Invalid username or password.");
          throw new Error(
            exists === true && !isInternalServerError(message)
              ? "Incorrect password."
              : "Invalid username or password.",
          );
        }

        setPassword("");
        setAuthenticatedUsername(cleanUsername);
        router.refresh();
        return;
      }
    } catch (err) {
      const message = errorMessage(
        err,
        "Authentication failed. Please try again.",
      );
      if (isSignUp && usernameCheckFailed && isInternalServerError(message)) {
        setError({ kind: "check-failed", username: cleanUsername });
        return;
      }

      setError({
        kind: "text",
        message: isInternalServerError(message)
          ? isSignUp
            ? "We couldn't create your account right now. We couldn't verify whether that username is already in use; try signing in if you already have an account, or try again later."
            : "Invalid username or password."
          : message,
      });
    } finally {
      setLoading(false);
    }
  }

  if (authenticatedUsername) {
    const successLabel = isSignUp
      ? "Account created successfully"
      : "Signed in successfully";

    return (
      <section
        aria-labelledby="authentication-success-title"
        className="motion-fade-up mx-auto w-full max-w-4xl py-8 sm:py-12"
      >
        <div className="grid items-center gap-8 md:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)] md:gap-14">
          <div>
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">
              <CheckIcon className="h-6 w-6" />
            </div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">
              {successLabel}
            </p>
            <h1
              id="authentication-success-title"
              className="mt-2 max-w-xl font-serif text-4xl font-medium leading-tight tracking-tight text-foreground sm:text-5xl"
            >
              {isSignUp ? "Welcome" : "Welcome back"}, {authenticatedUsername}.
            </h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-muted">
              {isSignUp
                ? "Your account is ready. Start exploring Singapore law, ask a research question, or build your saved workspace."
                : "You're signed in. Continue exploring Singapore law, ask a research question, or return to your saved workspace."}
            </p>
          </div>

          <nav
            aria-label={`${successLabel} next steps`}
            className="border-t border-border pt-5 md:border-l md:border-t-0 md:pl-10 md:pt-0"
          >
            <p className="pb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-2">
              Choose where to begin
            </p>
            <SuccessDestination
              href="/"
              icon={<SearchIcon className="h-5 w-5" />}
              title="Go to Search"
              description="Find judgments, legislation, and legal materials."
            />
            <SuccessDestination
              href="/ask"
              icon={<SparkleIcon className="h-5 w-5" />}
              title="Ask Lawplain"
              description="Research a legal question with cited answers."
            />
            <SuccessDestination
              href="/saved"
              icon={<BookIcon className="h-5 w-5" />}
              title="View saved research"
              description="Organise the authorities and answers you keep."
              last
            />
          </nav>
        </div>
      </section>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-sm">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-2">
          Lawplain account
        </p>
        <h1 className="mt-1 font-serif text-2xl font-medium text-foreground">
          {isSignUp ? "Create an account" : "Sign in"}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {isSignUp
            ? "Use a username and password to save research under your profile."
            : "Sign in to use saved research features and Ask Lawplain."}
        </p>
      </div>

      <button
        type="button"
        onClick={onGoogleSignIn}
        disabled={loading || googleLoading}
        className="flex w-full items-center justify-center gap-3 rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5">
          <path
            fill="#4285F4"
            d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.91h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.32 2.98-7.4Z"
          />
          <path
            fill="#34A853"
            d="M12 22c2.7 0 4.97-.9 6.63-2.43l-3.24-2.54c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z"
          />
          <path
            fill="#FBBC05"
            d="M6.39 13.86A6.01 6.01 0 0 1 6.08 12c0-.65.11-1.28.31-1.86V7.52H3.04A10 10 0 0 0 2 12c0 1.61.38 3.14 1.04 4.48l3.35-2.62Z"
          />
          <path
            fill="#EA4335"
            d="M12 6.01c1.47 0 2.79.5 3.82 1.49l2.88-2.88A9.65 9.65 0 0 0 12 2a10 10 0 0 0-8.96 5.52l3.35 2.62C7.18 7.77 9.39 6.01 12 6.01Z"
          />
        </svg>
        {googleLoading ? "Connecting to Google…" : "Continue with Google"}
      </button>

      <div className="my-5 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs font-medium uppercase tracking-wide text-muted-2">
          or
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block text-sm font-medium text-foreground">
          Username
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            className="mt-1 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-2 focus:border-accent"
            placeholder="e.g. rachel"
            required
          />
        </label>

        <label className="block text-sm font-medium text-foreground">
          Password
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete={isSignUp ? "new-password" : "current-password"}
            className="mt-1 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-2 focus:border-accent"
            required
          />
        </label>

        {isSignUp && (
          <label className="block text-sm font-medium text-foreground">
            Confirm password
            <input
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              type="password"
              autoComplete="new-password"
              className="mt-1 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-2 focus:border-accent"
              required
            />
          </label>
        )}

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error.kind === "unregistered" ? (
              <>
                No account found for “{error.username}”.{" "}
                <Link
                  href={`/sign-up?next=${encodeURIComponent(next)}`}
                  className="font-medium underline"
                >
                  Create an account
                </Link>
                .
              </>
            ) : error.kind === "registered" ? (
              <>
                Username “{error.username}” is already in use.{" "}
                <Link
                  href={`/sign-in?next=${encodeURIComponent(next)}`}
                  className="font-medium underline"
                >
                  Sign in instead
                </Link>
                .
              </>
            ) : error.kind === "check-failed" ? (
              <>
                We couldn't check whether “{error.username}” is already in use.
                Try{" "}
                <Link
                  href={`/sign-in?next=${encodeURIComponent(next)}`}
                  className="font-medium underline"
                >
                  signing in
                </Link>{" "}
                if you already have an account, or try again later.
              </>
            ) : (
              error.message
            )}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || googleLoading}
          className="w-full rounded-xl bg-foreground px-4 py-2.5 text-sm font-semibold text-primary-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading
            ? isSignUp
              ? "Creating account…"
              : "Signing in…"
            : isSignUp
              ? "Create account"
              : "Sign in"}
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-muted">
        {isSignUp ? "Already have an account?" : "No account yet?"}{" "}
        <Link
          href={
            isSignUp
              ? `/sign-in?next=${encodeURIComponent(next)}`
              : `/sign-up?next=${encodeURIComponent(next)}`
          }
          className="font-medium text-accent hover:underline"
        >
          {isSignUp ? "Sign in" : "Create one"}
        </Link>
      </p>
    </div>
  );
}
