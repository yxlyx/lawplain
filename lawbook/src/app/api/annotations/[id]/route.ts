import { getSession } from "@/lib/auth";
import {
  deleteAnnotation,
  getAnnotation,
  updateAnnotationNote,
} from "@/lib/private-annotations";
import { privateJson, privateRoute } from "@/lib/private-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(
  req: Request,
  { params }: Context,
): Promise<Response> {
  return privateRoute(async () => {
    const session = await getSession(req.headers);
    if (!session)
      return privateJson({ error: "Authentication required" }, { status: 401 });
    const annotation = await getAnnotation(session.user.id, (await params).id);
    return annotation
      ? privateJson({ annotation })
      : privateJson({ error: "Annotation not found" }, { status: 404 });
  });
}

export async function PATCH(
  req: Request,
  { params }: Context,
): Promise<Response> {
  return privateRoute(async () => {
    const session = await getSession(req.headers);
    if (!session)
      return privateJson({ error: "Authentication required" }, { status: 401 });
    const body = (await req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (
      !body ||
      Object.keys(body).some((key) => key !== "note") ||
      !("note" in body) ||
      (body.note !== null &&
        (typeof body.note !== "string" || body.note.length > 10_000))
    )
      return privateJson(
        { error: "PATCH accepts only note (maximum 10000 characters)" },
        { status: 400 },
      );
    const annotation = await updateAnnotationNote(
      session.user.id,
      (await params).id,
      body.note as string | null,
    );
    return annotation
      ? privateJson({ annotation })
      : privateJson({ error: "Annotation not found" }, { status: 404 });
  });
}

export async function DELETE(
  req: Request,
  { params }: Context,
): Promise<Response> {
  return privateRoute(async () => {
    const session = await getSession(req.headers);
    if (!session)
      return privateJson({ error: "Authentication required" }, { status: 401 });
    const removed = await deleteAnnotation(session.user.id, (await params).id);
    return removed
      ? privateJson({ ok: true })
      : privateJson({ error: "Annotation not found" }, { status: 404 });
  });
}
