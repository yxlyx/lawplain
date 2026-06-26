"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

type AuthFormProps = {
  mode: "sign-in" | "sign-up";
};

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

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get("next"));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isSignUp = mode === "sign-up";

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanUsername = username.trim();
    setError(null);

    if (!cleanUsername || !password) {
      setError("Enter a username and password.");
      return;
    }

    if (isSignUp && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      if (isSignUp) {
        const { error } = await authClient.signUp.email({
          name: cleanUsername,
          email: accountEmail(cleanUsername),
          password,
          username: cleanUsername,
          displayUsername: cleanUsername,
        });
        if (error) throw error;
      } else {
        const { error } = await authClient.signIn.username({
          username: cleanUsername,
          password,
        });
        if (error) throw error;
      }

      router.push(next);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err, "Authentication failed. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full rounded-2xl border border-border bg-surface p-6 shadow-sm">
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
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
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
