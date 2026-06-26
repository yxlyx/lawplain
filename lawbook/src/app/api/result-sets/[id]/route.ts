import { getSession } from "@/lib/auth";
import {
  deleteSavedResultSet,
  getSavedResultSet,
  normalizeResultSetName,
  updateSavedResultSet,
} from "@/lib/saved-result-sets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getSession(req.headers);
  if (!session)
    return Response.json({ error: "Authentication required" }, { status: 401 });
  const { id } = await params;
  const resultSet = await getSavedResultSet({ userId: session.user.id, id });
  if (!resultSet)
    return Response.json({ error: "Result set not found" }, { status: 404 });
  return Response.json({ resultSet });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getSession(req.headers);
  if (!session)
    return Response.json({ error: "Authentication required" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const name = normalizeResultSetName(body?.name);
  if (!name)
    return Response.json({ error: "Name is required" }, { status: 400 });
  const { id } = await params;
  const resultSet = await updateSavedResultSet({
    userId: session.user.id,
    id,
    name,
  });
  if (!resultSet)
    return Response.json({ error: "Result set not found" }, { status: 404 });
  return Response.json({ resultSet });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getSession(req.headers);
  if (!session)
    return Response.json({ error: "Authentication required" }, { status: 401 });
  const { id } = await params;
  const deleted = await deleteSavedResultSet({ userId: session.user.id, id });
  if (!deleted)
    return Response.json({ error: "Result set not found" }, { status: 404 });
  return Response.json({ ok: true });
}
