import { getSession } from "@/lib/auth";
import { deleteSearchHistoryEntry } from "@/lib/search-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getSession(req.headers);
  if (!session)
    return Response.json({ error: "Authentication required" }, { status: 401 });
  const { id } = await params;
  const deleted = await deleteSearchHistoryEntry({
    userId: session.user.id,
    id,
  });
  if (!deleted)
    return Response.json(
      { error: "Search history entry not found" },
      { status: 404 },
    );
  return Response.json({ ok: true });
}
