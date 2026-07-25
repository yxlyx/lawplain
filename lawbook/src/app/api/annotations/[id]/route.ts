import { isAnnotationLabelId } from "@/lib/annotation-labels";
import { getSession } from "@/lib/auth";
import {
  type AnnotationChanges,
  deleteAnnotation,
  getAnnotation,
  updateAnnotation,
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
    // Only the user's own note and label are editable; the captured passage is
    // immutable, so an unknown key is rejected rather than ignored.
    if (
      !body ||
      Object.keys(body).some((key) => key !== "note" && key !== "label") ||
      !("note" in body || "label" in body) ||
      ("note" in body &&
        body.note !== null &&
        (typeof body.note !== "string" || body.note.length > 10_000)) ||
      ("label" in body && !isAnnotationLabelId(body.label))
    )
      return privateJson(
        {
          error:
            "PATCH accepts note (maximum 10000 characters) and a known label",
        },
        { status: 400 },
      );
    const changes: AnnotationChanges = {};
    if ("note" in body) changes.note = body.note as string | null;
    if ("label" in body) changes.label = body.label as string;
    const annotation = await updateAnnotation(
      session.user.id,
      (await params).id,
      changes,
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
