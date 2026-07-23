import { getSession } from "@/lib/auth";
import {
  type Annotation,
  createAnnotation,
  listAnnotations,
  normalizeAnnotationInput,
} from "@/lib/private-annotations";
import { privateJson, privateRoute } from "@/lib/private-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function GET(req: Request): Promise<Response> {
  return privateRoute(async () => {
    const session = await getSession(req.headers);
    if (!session)
      return privateJson({ error: "Authentication required" }, { status: 401 });
    const result = await listAnnotations(session.user.id, { limit: 100 });
    return privateJson({ quotes: result.annotations.map(asQuote) });
  });
}

export async function POST(req: Request): Promise<Response> {
  return privateRoute(async () => {
    const session = await getSession(req.headers);
    if (!session)
      return privateJson({ error: "Authentication required" }, { status: 401 });
    const raw = (await req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const input = normalizeAnnotationInput(
      raw ? { ...raw, title: raw.sourceTitle ?? raw.title } : null,
    );
    if (!input) return privateJson({ error: "Invalid quote" }, { status: 400 });
    try {
      const annotation = await createAnnotation(session.user.id, input);
      return privateJson({ quote: asQuote(annotation) }, { status: 201 });
    } catch (error) {
      if (error instanceof Error && error.message === "STALE_ANNOTATION_WRITE")
        return privateJson(
          { error: "Quote changed; select the passage again" },
          { status: 409 },
        );
      throw error;
    }
  });
}
