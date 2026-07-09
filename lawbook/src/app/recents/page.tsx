import type { Metadata } from "next";
import { RecentlyViewedList } from "@/components/RecentlyViewedList";

export const metadata: Metadata = {
  title: "Recently viewed — Lawplain",
};

export default function RecentsPage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8">
      <div className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-2">
          Workspace
        </p>
        <h1 className="mt-2 font-serif text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
          Recently viewed
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Documents you have opened while signed in, newest first. Use this to
          quickly resume research without re-running searches.
        </p>
      </div>
      <RecentlyViewedList />
    </main>
  );
}
