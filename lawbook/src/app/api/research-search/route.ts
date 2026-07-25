import { isAnnotationLabelId } from "@/lib/annotation-labels";
import { getSession } from "@/lib/auth";
import { privateJson, privateRoute } from "@/lib/private-response";
import {
  normalizeSearchQuery,
  searchPrivateResearch,
} from "@/lib/private-search";
import { isSavedDocType } from "@/lib/saved-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Search only the authenticated reader's own research.
 *
 * Nothing about the query is logged or reported anywhere: a private search term
 * is as sensitive as the note it finds, so it never reaches analytics and the
 * shared privateRoute handler keeps it out of ordinary error logs too.
 */
export async function GET(req: Request): Promise<Response> {
  return privateRoute(async () => {
    const session = await getSession(req.headers);
    if (!session)
      return privateJson({ error: "Authentication required" }, { status: 401 });
    const params = new URL(req.url).searchParams;

    const q = normalizeSearchQuery(params.get("q"));
    if (!q)
      return privateJson(
        { error: "Enter something to search for" },
        { status: 400 },
      );

    const rawType = params.get("docType");
    if (rawType !== null && !isSavedDocType(rawType))
      return privateJson({ error: "Invalid document type" }, { status: 400 });
    const rawLabel = params.get("label");
    if (rawLabel !== null && !isAnnotationLabelId(rawLabel))
      return privateJson({ error: "Invalid label" }, { status: 400 });
    const rawLimit = params.get("limit");
    const limit = rawLimit === null ? undefined : Number(rawLimit);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1))
      return privateJson({ error: "Invalid limit" }, { status: 400 });

    try {
      return privateJson(
        await searchPrivateResearch(session.user.id, {
          q,
          docType: rawType ?? undefined,
          label: rawLabel ?? undefined,
          tagId: params.get("tagId") ?? undefined,
          collectionId: params.get("collectionId") ?? undefined,
          limit,
          cursor: params.get("cursor"),
        }),
      );
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_CURSOR")
        return privateJson({ error: "Invalid cursor" }, { status: 400 });
      throw error;
    }
  });
}
