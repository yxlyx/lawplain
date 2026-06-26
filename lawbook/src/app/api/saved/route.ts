import { getSession } from "@/lib/auth";
import {
  cleanText,
  deleteSavedAuthority,
  getSavedAuthority,
  isSavedDocType,
  listSavedAuthorities,
  saveAuthority,
} from "@/lib/saved-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const session = await getSession(req.headers);
  if (!session)
    return Response.json({ error: "Authentication required" }, { status: 401 });
  const url = new URL(req.url);
  const docType = url.searchParams.get("docType");
  const docId = url.searchParams.get("docId");
  if (docType || docId) {
    if (!isSavedDocType(docType) || !docId)
      return Response.json({ error: "Invalid lookup" }, { status: 400 });
    return Response.json({
      saved: await getSavedAuthority({
        userId: session.user.id,
        docType,
        docId,
      }),
    });
  }
  return Response.json({
    authorities: await listSavedAuthorities(session.user.id),
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
  const path = cleanText(body.path, 800);
  if (!docId || !title || !path.startsWith("/"))
    return Response.json({ error: "Missing details" }, { status: 400 });
  return Response.json(
    {
      saved: await saveAuthority({
        userId: session.user.id,
        docType: body.docType,
        docId,
        title,
        path,
      }),
    },
    { status: 201 },
  );
}

export async function DELETE(req: Request): Promise<Response> {
  const session = await getSession(req.headers);
  if (!session)
    return Response.json({ error: "Authentication required" }, { status: 401 });
  const url = new URL(req.url);
  const docType = url.searchParams.get("docType");
  const docId = url.searchParams.get("docId");
  if (!isSavedDocType(docType) || !docId)
    return Response.json({ error: "Invalid saved authority" }, { status: 400 });
  await deleteSavedAuthority({ userId: session.user.id, docType, docId });
  return Response.json({ ok: true });
}
