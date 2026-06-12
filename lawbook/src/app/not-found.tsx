import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col items-center px-5 py-28 text-center sm:px-8">
      <p className="font-mono text-sm uppercase tracking-[0.2em] text-accent">
        404
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
        Record not found
      </h1>
      <p className="mt-3 max-w-md text-muted">
        We couldn&rsquo;t find that document in the corpus. It may have a
        different citation, or it isn&rsquo;t part of the current dataset.
      </p>
      <Link
        href="/"
        className="mt-7 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-fg transition-opacity hover:opacity-90"
      >
        Back to search
      </Link>
    </main>
  );
}
