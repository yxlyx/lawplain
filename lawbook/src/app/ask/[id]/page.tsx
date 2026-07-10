/**
 * /ask/[id] — a fixed, resumable Lawplain research thread.
 *
 * Same chat surface as /ask, but bound to a saved thread id so the
 * conversation can be linked to and returned to. The client restores the
 * thread (or reconnects to an in-flight run) from the id on mount.
 */
import type { Metadata } from "next";
import { AskAgent } from "@/components/AskAgent";
import { buildMetadata } from "@/lib/seo";

export function generateMetadata(): Metadata {
  return buildMetadata({
    title: "Ask Lawplain",
    description:
      "A saved Lawplain research thread across Singapore judgments, statutes, Hansard, bills and practice directions.",
    path: "/ask",
    noIndex: true,
    noIndexFollow: true,
  });
}

export const dynamic = "force-dynamic";

export default async function AskThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <main className="mx-auto h-[calc(100dvh-3.5rem)] min-h-0 w-full max-w-2xl overflow-hidden px-5 sm:px-8">
      <AskAgent initialThreadId={id} />
    </main>
  );
}
