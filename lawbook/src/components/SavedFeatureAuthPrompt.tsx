import Link from "next/link";

export function SavedFeatureAuthPrompt({
  next,
  title = "Sign in to save research",
  body = "Create a free account or sign in to keep saved documents and highlights across devices.",
  compact = false,
}: {
  next: string;
  title?: string;
  body?: string;
  compact?: boolean;
}) {
  const encodedNext = encodeURIComponent(next || "/");

  return (
    <div
      className={
        compact
          ? "rounded-xl border border-border bg-surface p-3 text-sm shadow-lg"
          : "rounded-2xl border border-border bg-surface p-8 text-center"
      }
    >
      <h2
        className={
          compact
            ? "font-medium text-foreground"
            : "font-serif text-2xl font-medium text-foreground"
        }
      >
        {title}
      </h2>
      <p
        className={
          compact
            ? "mt-1 text-xs leading-5 text-muted"
            : "mx-auto mt-2 max-w-md text-sm leading-6 text-muted"
        }
      >
        {body}
      </p>
      <div
        className={
          compact
            ? "mt-3 flex flex-wrap gap-2"
            : "mt-5 flex flex-wrap justify-center gap-2"
        }
      >
        <Link
          href={`/sign-in?next=${encodedNext}`}
          className="inline-flex rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-primary-fg transition-opacity hover:opacity-90"
        >
          Sign in
        </Link>
        <Link
          href={`/sign-up?next=${encodedNext}`}
          className="inline-flex rounded-lg border border-border-strong px-4 py-2 text-sm font-medium text-muted transition-colors hover:border-accent hover:text-foreground"
        >
          Create account
        </Link>
      </div>
    </div>
  );
}
