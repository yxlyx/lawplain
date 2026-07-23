import { getSession } from "@/lib/auth";
import {
  createAnnotation,
  listAnnotations,
  normalizeAnnotationInput,
} from "@/lib/private-annotations";
import { privateJson, privateRoute } from "@/lib/private-response";
import { isSavedDocType } from "@/lib/saved-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return privateRoute(async () => {
    const session = await getSession(req.headers);
    if (!session)
      return privateJson({ error: "Authentication required" }, { status: 401 });
    const params = new URL(req.url).searchParams;
    const rawType = params.get("docType");
    if (rawType && !isSavedDocType(rawType))
      return privateJson({ error: "Invalid document type" }, { status: 400 });
    const docType = isSavedDocType(rawType) ? rawType : undefined;
    const rawLimit = params.get("limit");
    const limit = rawLimit === null ? undefined : Number(rawLimit);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1))
      return privateJson({ error: "Invalid limit" }, { status: 400 });
    try {
      return privateJson(
        await listAnnotations(session.user.id, {
          limit,
          cursor: params.get("cursor"),
          docType,
          docId: params.get("docId") || undefined,
        }),
      );
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_CURSOR")
        return privateJson({ error: "Invalid cursor" }, { status: 400 });
      throw error;
    }
  });
}

export async function POST(req: Request): Promise<Response> {
  return privateRoute(async () => {
    const session = await getSession(req.headers);
    if (!session)
      return privateJson({ error: "Authentication required" }, { status: 401 });
    const input = normalizeAnnotationInput(await req.json().catch(() => null));
    if (!input)
      return privateJson({ error: "Invalid annotation" }, { status: 400 });
    try {
      return privateJson(
        { annotation: await createAnnotation(session.user.id, input) },
        { status: 201 },
      );
    } catch (error) {
      if (error instanceof Error && error.message === "STALE_ANNOTATION_WRITE")
        return privateJson(
          { error: "Annotation changed; select the passage again" },
          { status: 409 },
        );
      throw error;
    }
  });
}
