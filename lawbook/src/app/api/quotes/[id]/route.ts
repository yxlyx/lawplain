import { getSession } from "@/lib/auth";
import {
  deleteSavedQuote,
  getSavedQuote,
  restoreSavedQuote,
} from "@/lib/saved-quotes";

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
  const quote = await getSavedQuote(session.user.id, id);
  if (!quote)
    return Response.json({ error: "Quote not found" }, { status: 404 });
  return Response.json({ quote });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getSession(req.headers);
  if (!session)
    return Response.json({ error: "Authentication required" }, { status: 401 });
  const { id } = await params;
  const quote = await deleteSavedQuote(session.user.id, id);
  if (!quote)
    return Response.json({ error: "Quote not found" }, { status: 404 });
  return Response.json({ quote });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getSession(req.headers);
  if (!session)
    return Response.json({ error: "Authentication required" }, { status: 401 });
  const { id } = await params;
  const quote = await restoreSavedQuote(session.user.id, id);
  if (!quote)
    return Response.json(
      { error: "Undo expired or quote not found" },
      { status: 409 },
    );
  return Response.json({ quote });
}
