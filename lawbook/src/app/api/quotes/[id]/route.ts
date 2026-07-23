import { getSession } from "@/lib/auth";
import {
  type Annotation,
  getAnnotation,
  resolveLegacyAnnotationId,
  restoreSoftDeletedAnnotation,
  softDeleteAnnotation,
} from "@/lib/private-annotations";
import { privateJson, privateRoute } from "@/lib/private-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

function asQuote(annotation: Annotation) {
  const {
    title,
    authorityId: _authorityId,
    note: _note,
    updatedAt: _updatedAt,
    ...quote
  } = annotation;
  return { ...quote, sourceTitle: title };
}

export async function GET(
  req: Request,
  { params }: Context,
): Promise<Response> {
  return privateRoute(async () => {
    const session = await getSession(req.headers);
    if (!session)
      return privateJson({ error: "Authentication required" }, { status: 401 });
    const id = await resolveLegacyAnnotationId(
      session.user.id,
      (await params).id,
    );
    const quote = await getAnnotation(session.user.id, id);
    return quote
      ? privateJson({ quote: asQuote(quote) })
      : privateJson({ error: "Quote not found" }, { status: 404 });
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
    const id = await resolveLegacyAnnotationId(
      session.user.id,
      (await params).id,
    );
    const quote = await softDeleteAnnotation(session.user.id, id);
    return quote
      ? privateJson({ quote: asQuote(quote) })
      : privateJson({ error: "Quote not found" }, { status: 404 });
  });
}

export async function POST(
  req: Request,
  { params }: Context,
): Promise<Response> {
  return privateRoute(async () => {
    const session = await getSession(req.headers);
    if (!session)
      return privateJson({ error: "Authentication required" }, { status: 401 });
    const id = await resolveLegacyAnnotationId(
      session.user.id,
      (await params).id,
    );
    const quote = await restoreSoftDeletedAnnotation(session.user.id, id);
    return quote
      ? privateJson({ quote: asQuote(quote) })
      : privateJson(
          { error: "Undo expired or quote not found" },
          { status: 409 },
        );
  });
}
