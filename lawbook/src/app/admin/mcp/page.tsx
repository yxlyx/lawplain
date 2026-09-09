import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { McpAdminDashboard } from "@/components/McpAdminDashboard";
import { getSession } from "@/lib/auth";
import { isMcpAdmin } from "@/server/mcp-auth";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "MCP administration",
  robots: { index: false, follow: false },
};

export default async function McpAdminPage() {
  const session = await getSession(await headers());
  if (!session) redirect("/sign-in?next=%2Fadmin%2Fmcp");
  if (!(await isMcpAdmin(session.user.id))) notFound();
  return (
    <main className="mx-auto max-w-5xl px-5 py-8 sm:px-8">
      <Link href="/developers" className="text-sm text-muted underline">
        Back to API & MCP access
      </Link>
      <h1 className="mt-6 font-serif text-3xl text-foreground">
        MCP administration
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
        Approve research connections, control access to sources, and review
        usage. These controls apply to the Lawplain MCP endpoint.
      </p>
      <McpAdminDashboard />
    </main>
  );
}
