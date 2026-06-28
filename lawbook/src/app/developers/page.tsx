import type { Metadata } from "next";
import Link from "next/link";
import { ApiKeysManager } from "@/components/ApiKeysManager";
import { ArrowLeftIcon } from "@/components/icons";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Developers — API access",
  description:
    "Create a personal API key to call the Lawplain corpus API from your own agents and scripts.",
  path: "/developers",
});

export const dynamic = "force-dynamic";

export default function DevelopersPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-5 pb-16 sm:px-8">
      <div className="pt-6 sm:pt-8">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-2 transition-colors hover:text-foreground"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back to search
        </Link>
      </div>

      <header className="mt-6">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">
          API access
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Point your own agents and scripts at the same Singapore legal corpus
          that powers Lawplain. Create a key below, then call the read-only API
          with it.
        </p>
      </header>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-2">
          Your keys
        </h2>
        <div className="mt-3">
          <ApiKeysManager />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-2">
          Quickstart
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Pass your key as a Bearer token. The API mirrors the corpus endpoints
          (judgments, statutes, Hansard, bills, subsidiary legislation, practice
          directions).
        </p>
        <pre className="mt-3 overflow-x-auto rounded-xl border border-border bg-surface-2/50 p-4 font-mono text-[13px] leading-relaxed text-foreground">
          {`curl -H "Authorization: Bearer lp_live_…" \\
  "https://lawplain.com/api/v1/judgments/search?q=negligence&limit=5"`}
        </pre>
        <p className="mt-3 text-xs leading-relaxed text-muted-2">
          Read-only (GET). Endpoints and parameters match{" "}
          <span className="font-mono">/v1/*</span> on the corpus API — e.g.{" "}
          <span className="font-mono">/api/v1/statutes/search?q=</span>,{" "}
          <span className="font-mono">
            /api/v1/judgments/&#123;citation&#125;
          </span>
          . Legal information, not advice.
        </p>
      </section>
    </main>
  );
}
