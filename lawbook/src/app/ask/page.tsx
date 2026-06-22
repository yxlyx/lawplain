/**
 * /ask — dedicated Lawplain research chat page.
 *
 * Standalone (no context): a full-width research assistant.
 * With ?cite=<ref>&kind=judgment|statute: the chat is pre-grounded in that
 *   document (fetched server-side) — reached from the detail pages' "Ask
 *   Lawplain about this" link.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { AskAgent } from "@/components/AskAgent";
import { ArrowLeftIcon, SparkleIcon } from "@/components/icons";
import { loadChatContext } from "@/lib/ask-context";

export const metadata: Metadata = {
  title: "Ask Lawplain — Singapore legal research",
  description:
    "Ask questions about Singapore law in plain English. An agent searches the corpus and writes a cited answer.",
};

export const dynamic = "force-dynamic";

export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<{ cite?: string; kind?: string }>;
}) {
  const params = new URLSearchParams();
  const sp = await searchParams;
  if (sp.cite) params.set("cite", sp.cite);
  if (sp.kind) params.set("kind", sp.kind);
  const context = await loadChatContext(params);

  return (
    <main className="mx-auto w-full max-w-2xl px-5 pb-6 sm:px-8">
      <div className="pt-6 sm:pt-8">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-2 transition-colors hover:text-foreground"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back to search
        </Link>
      </div>

      <header className="pb-4 pt-5 text-center">
        <h1 className="inline-flex items-center gap-2.5 font-serif text-4xl font-medium tracking-tight text-foreground sm:text-5xl">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <SparkleIcon className="h-5 w-5" />
          </span>
          Ask Lawplain
        </h1>
        <p className="mt-3 text-sm text-muted">
          {context
            ? `Grounded in ${context.kind === "judgment" ? "judgment" : "statute"}: ${context.title}`
            : "Natural-language research across the Singapore legal corpus."}
        </p>
      </header>

      <AskAgent initialContext={context ?? undefined} />
    </main>
  );
}
