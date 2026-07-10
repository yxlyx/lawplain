/**
 * /ask/[id] — a fixed, resumable Lawplain research thread.
 *
 * Same chat surface as /ask, but bound to a saved thread id so the
 * conversation can be linked to and returned to. The client restores the
 * thread (or reconnects to an in-flight run) from the id on mount.
 */
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AskAgent } from "@/components/AskAgent";
import { getSession } from "@/lib/auth";
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
  const session = await getSession(new Headers(await headers()));
  if (!session?.user?.id) {
    redirect(`/sign-in?next=${encodeURIComponent(`/ask/${id}`)}`);
  }

  return (
    <main className="h-[calc(100dvh-3.5rem)] min-h-0 w-full overflow-hidden">
      <AskAgent initialThreadId={id} />
    </main>
  );
}
