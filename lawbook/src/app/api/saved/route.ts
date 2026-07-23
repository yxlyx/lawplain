import { getSession } from "@/lib/auth";
import { normalizeInternalPath } from "@/lib/internal-path";
import { privateJson, privateRoute } from "@/lib/private-response";
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
  return privateRoute(async () => {
    const session = await getSession(req.headers);
    if (!session)
      return privateJson({ error: "Authentication required" }, { status: 401 });
    const url = new URL(req.url);
    const docType = url.searchParams.get("docType");
    const docId = url.searchParams.get("docId");
    if (docType || docId) {
      if (!isSavedDocType(docType) || !docId)
        return privateJson({ error: "Invalid lookup" }, { status: 400 });
      return privateJson({
        saved: await getSavedAuthority({
          userId: session.user.id,
          docType,
          docId,
        }),
      });
    }
    return privateJson({
      authorities: await listSavedAuthorities(session.user.id),
    });
  });
}

export async function POST(req: Request): Promise<Response> {
  return privateRoute(async () => {
    const session = await getSession(req.headers);
    if (!session)
      return privateJson({ error: "Authentication required" }, { status: 401 });
    const body = (await req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || !isSavedDocType(body.docType))
      return privateJson({ error: "Invalid document type" }, { status: 400 });
    const docId = cleanText(body.docId, 300);
    const title = cleanText(body.title, 500);
    const path = normalizeInternalPath(body.path);
    const citation = cleanText(body.citation, 500);
    if (!docId || !title || !path || !path.startsWith(`/${body.docType}/`))
      return privateJson({ error: "Missing details" }, { status: 400 });
    return privateJson(
      {
        saved: await saveAuthority({
          userId: session.user.id,
          docType: body.docType,
          docId,
          title,
          path,
          citation,
        }),
      },
      { status: 201 },
    );
  });
}

export async function DELETE(req: Request): Promise<Response> {
  return privateRoute(async () => {
    const session = await getSession(req.headers);
    if (!session)
      return privateJson({ error: "Authentication required" }, { status: 401 });
    const url = new URL(req.url);
    const docType = url.searchParams.get("docType");
    const docId = url.searchParams.get("docId");
    if (!isSavedDocType(docType) || !docId)
      return privateJson({ error: "Invalid saved authority" }, { status: 400 });
    await deleteSavedAuthority({
      userId: session.user.id,
      docType,
      docId,
    });
    return privateJson({ ok: true });
  });
}
