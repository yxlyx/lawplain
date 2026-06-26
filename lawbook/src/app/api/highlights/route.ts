import { getSession } from "@/lib/auth";
import {
  cleanText,
  createSavedHighlight,
  deleteSavedHighlight,
  isSavedDocType,
  listSavedHighlights,
} from "@/lib/saved-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const session = await getSession(req.headers);
  if (!session)
    return Response.json({ error: "Authentication required" }, { status: 401 });
  return Response.json({
    highlights: await listSavedHighlights(session.user.id),
  });
}

export async function POST(req: Request): Promise<Response> {
  const session = await getSession(req.headers);
  if (!session)
    return Response.json({ error: "Authentication required" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body || !isSavedDocType(body.docType))
    return Response.json({ error: "Invalid document type" }, { status: 400 });
  const docId = cleanText(body.docId, 300);
  const title = cleanText(body.title, 500);
  const path = cleanText(body.path, 900);
  const selectedText = cleanText(body.selectedText, 4000);
  const sectionId = cleanText(body.sectionId, 200) || undefined;
  if (!docId || !title || !path.startsWith("/") || !selectedText)
    return Response.json(
      { error: "Missing highlight details" },
      { status: 400 },
    );
  return Response.json(
    {
      highlight: await createSavedHighlight({
        userId: session.user.id,
        docType: body.docType,
        docId,
        title,
        path,
        sectionId,
        selectedText,
      }),
    },
    { status: 201 },
  );
}

export async function DELETE(req: Request): Promise<Response> {
  const session = await getSession(req.headers);
  if (!session)
    return Response.json({ error: "Authentication required" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id")?.trim();
  if (!id)
    return Response.json({ error: "Missing highlight id" }, { status: 400 });
  await deleteSavedHighlight({ userId: session.user.id, id });
  return Response.json({ ok: true });
}
