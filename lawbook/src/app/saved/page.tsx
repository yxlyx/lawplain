import type { Metadata } from "next";
import { ResearchSearch } from "@/components/ResearchSearch";
import { SavedAnnotations } from "@/components/SavedAnnotations";
import { SavedAnswers } from "@/components/SavedAnswers";
import { SavedSearchHistory } from "@/components/SavedSearchHistory";
import { SavedWorkspace } from "@/components/SavedWorkspace";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "My Library",
  description: "Your private Singapore legal research workspace.",
  path: "/saved",
  noIndex: true,
});

export default function SavedPage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8">
      <div className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-2">
          Workspace
        </p>
        <h1 className="mt-2 font-serif text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
          My Library
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Your documents, private annotations and notes live here. Searches and
          answers do too. Everything on this page is private to you.
        </p>
      </div>
      <ResearchSearch />
      <SavedWorkspace />
      <SavedAnnotations />
      <SavedSearchHistory />
      <SavedAnswers />
    </main>
  );
}
