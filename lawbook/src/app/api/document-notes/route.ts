import { getSession } from "@/lib/auth";
import {
  deleteDocumentNote,
  getDocumentNote,
  normalizeDocumentNoteInput,
  saveDocumentNote,
} from "@/lib/document-notes";
import { privateJson, privateRoute } from "@/lib/private-response";
import { isSavedDocType } from "@/lib/saved-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One note per document, so the document itself is the address: there is no note
 * id in the URL to guess, and every statement underneath is owner-scoped.
 */
function documentFrom(req: Request) {
  const params = new URL(req.url).searchParams;
  const rawType = params.get("docType");
  if (!isSavedDocType(rawType)) return null;
  const docId = params.get("docId");
  if (!docId) return null;
  return { docType: rawType, docId };
}

export async function GET(req: Request): Promise<Response> {
  return privateRoute(async () => {
    const session = await getSession(req.headers);
    if (!session)
      return privateJson({ error: "Authentication required" }, { status: 401 });
    const target = documentFrom(req);
    if (!target)
      return privateJson({ error: "Invalid document" }, { status: 400 });
    return privateJson({
      note: await getDocumentNote(
        session.user.id,
        target.docType,
        target.docId,
      ),
    });
  });
}

export async function PUT(req: Request): Promise<Response> {
  return privateRoute(async () => {
    const session = await getSession(req.headers);
    if (!session)
      return privateJson({ error: "Authentication required" }, { status: 401 });
    const input = normalizeDocumentNoteInput(
      await req.json().catch(() => null),
    );
    if (!input) return privateJson({ error: "Invalid note" }, { status: 400 });
    try {
      return privateJson({
        note: await saveDocumentNote(session.user.id, input),
      });
    } catch (error) {
      if (error instanceof Error && error.message === "STALE_NOTE_WRITE")
        return privateJson(
          {
            error:
              "This document's research was deleted; reopen it to start a new note",
          },
          { status: 409 },
        );
      throw error;
    }
  });
}

export async function DELETE(req: Request): Promise<Response> {
  return privateRoute(async () => {
    const session = await getSession(req.headers);
    if (!session)
      return privateJson({ error: "Authentication required" }, { status: 401 });
    const target = documentFrom(req);
    if (!target)
      return privateJson({ error: "Invalid document" }, { status: 400 });
    const deleted = await deleteDocumentNote(
      session.user.id,
      target.docType,
      target.docId,
    );
    // An honest 404 rather than a cheerful no-op, so a reader is never told
    // their note was removed when nothing was found to remove.
    if (!deleted)
      return privateJson({ error: "No note to delete" }, { status: 404 });
    return privateJson({ deleted: true });
  });
}
