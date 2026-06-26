import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon, SparkleIcon } from "@/components/icons";
import { JudgmentBody } from "@/components/JudgmentBody";
import type { CitationSource } from "@/lib/citations";

const body = `Introduction

1 This mock page previews the judgment reading experience when anonymous aggregate section suggestions have enough data to appear. It does not write to a database and does not call any development seed endpoint.

Background

2 The plaintiff says the defendant owed a duty of care. The defendant denies negligence and says any loss was too remote.

3 Readers searching for negligence often want to compare the factual background with the court's analysis.

The Legal Issue

4 The issue is whether the defendant breached the applicable standard of care and whether that breach caused the plaintiff's loss.

5 This section is also popular for readers who search negligence because it frames the elements the court later applies.

Analysis

6 The court considers duty, breach, causation, remoteness, and the evidence supporting each element.

7 On the facts, the negligence analysis turns on whether the defendant took reasonable precautions in light of the known risk.

8 This is the section most readers spend time on after searching for negligence.

Orders

9 The appeal is dismissed. The defendant is awarded costs fixed at $20,000 inclusive of disbursements.`;

const source: CitationSource = {
  kind: "judgment",
  title: "Mock Judgment: Suggested Sections Preview",
  citation: "MOCK 2026 SGHC 1",
};

export const metadata: Metadata = {
  title: "Suggested sections preview — Lawplain",
};

export default function SuggestionsPreviewPage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8">
      <Link
        href="/?tab=judgments"
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to search
      </Link>

      <header className="border-b border-border pb-6">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded bg-primary px-2 py-0.5 font-medium text-primary-fg">
            PREVIEW
          </span>
          <span className="font-mono text-muted">MOCK 2026 SGHC 1</span>
        </div>

        <h1 className="font-serif text-2xl font-medium leading-tight tracking-tight text-foreground sm:text-3xl">
          Mock Judgment: Suggested Sections Preview
        </h1>

        <p className="mt-4 text-sm leading-6 text-muted">
          This page shows what a judgment would look like once there is enough
          anonymous aggregate usage data for the search term{" "}
          <span className="font-medium text-foreground">negligence</span>. It
          uses in-memory mock suggestions only.
        </p>
        <p className="mt-2 text-sm leading-6 text-muted">
          Notice the side navigation stays in judgment order. The popular
          section gets an extra label; it is not moved to the top. Raw counts
          are not shown to users.
        </p>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Link
            href="/ask?cite=MOCK%202026%20SGHC%201&kind=judgment"
            className="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent-soft px-3.5 py-2 text-sm font-medium text-accent transition-colors hover:border-accent hover:bg-accent hover:text-primary-fg"
          >
            <SparkleIcon className="h-4 w-4" />
            Ask Lawplain about this
          </Link>
        </div>
      </header>

      <section className="mt-8">
        <JudgmentBody
          citation="MOCK 2026 SGHC 1"
          source={source}
          pagePath="/suggestions-preview"
          initialText={body}
          initialLoaded={body.length}
          total={body.length}
          query="negligence"
          mockSuggestions={{
            "h-analysis": {
              count: 88,
              badge: "Most viewed for 'negligence'",
            },
            "h-the-legal-issue": {
              count: 39,
            },
            "h-background": {
              count: 17,
            },
          }}
        />
      </section>
    </main>
  );
}
