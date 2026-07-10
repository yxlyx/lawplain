/**
 * /ask — dedicated Lawplain research chat page.
 *
 * Standalone (no context): a full-width research assistant.
 * With ?cite=<ref>&kind=judgment|statute: the chat is pre-grounded in that
 *   document (fetched server-side) — reached from the detail pages' "Ask
 *   Lawplain about this" link.
 */
import type { Metadata } from "next";
import { AskAgent } from "@/components/AskAgent";
import { loadChatContext } from "@/lib/ask-context";
import { buildMetadata } from "@/lib/seo";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ cite?: string; kind?: string }>;
}): Promise<Metadata> {
  const { cite, kind } = await searchParams;
  const hasContextVariant = Boolean(cite || kind);

  return buildMetadata({
    title: "Ask Lawplain",
    description:
      "Ask plain-English questions across Singapore judgments, statutes, Hansard, bills and practice directions, with cited legal information from Lawplain.",
    path: "/ask",
    noIndex: hasContextVariant,
    noIndexFollow: hasContextVariant,
  });
}

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
    <main className="mx-auto h-[calc(100dvh-3.5rem)] min-h-0 w-full max-w-2xl overflow-hidden px-5 sm:px-8">
      <AskAgent initialContext={context ?? undefined} />
    </main>
  );
}
