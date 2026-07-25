import { isAnnotationLabelId } from "@/lib/annotation-labels";
import { getSession } from "@/lib/auth";
import { type LibrarySort, listLibrary } from "@/lib/library";
import { privateJson, privateRoute } from "@/lib/private-response";
import { isSavedDocType } from "@/lib/saved-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SORTS: LibrarySort[] = ["activity", "saved", "title"];

function isSort(value: string | null): value is LibrarySort {
  return SORTS.includes(value as LibrarySort);
}

function timestamp(value: string | null): number | null | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export async function GET(req: Request): Promise<Response> {
  return privateRoute(async () => {
    const session = await getSession(req.headers);
    if (!session)
      return privateJson({ error: "Authentication required" }, { status: 401 });
    const params = new URL(req.url).searchParams;

    const rawLimit = params.get("limit");
    const limit = rawLimit === null ? undefined : Number(rawLimit);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1))
      return privateJson({ error: "Invalid limit" }, { status: 400 });

    const rawType = params.get("docType");
    if (rawType !== null && !isSavedDocType(rawType))
      return privateJson({ error: "Invalid document type" }, { status: 400 });

    // An unknown label would silently return an empty library, which reads as
    // "you have nothing" rather than "that filter is not a thing".
    const rawLabel = params.get("label");
    if (rawLabel !== null && !isAnnotationLabelId(rawLabel))
      return privateJson({ error: "Invalid label" }, { status: 400 });

    const rawSort = params.get("sort");
    if (rawSort !== null && !isSort(rawSort))
      return privateJson({ error: "Invalid sort" }, { status: 400 });

    const savedFrom = timestamp(params.get("savedFrom"));
    const savedTo = timestamp(params.get("savedTo"));
    if (savedFrom === null || savedTo === null)
      return privateJson({ error: "Invalid date range" }, { status: 400 });

    try {
      return privateJson(
        await listLibrary(session.user.id, {
          limit,
          cursor: params.get("cursor"),
          docType: rawType ?? undefined,
          label: rawLabel ?? undefined,
          hasPassageNotes: params.get("hasPassageNotes") === "true",
          hasDocumentNote: params.get("hasDocumentNote") === "true",
          hasOpenFollowUps: params.get("hasOpenFollowUps") === "true",
          tagId: params.get("tagId") ?? undefined,
          collectionId: params.get("collectionId") ?? undefined,
          savedFrom,
          savedTo,
          sort: rawSort ?? undefined,
          // Previews are requested, not filtered client-side: when a reader hides
          // them the note text never leaves the server at all.
          includePreview: params.get("preview") === "true",
        }),
      );
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_CURSOR")
        return privateJson({ error: "Invalid cursor" }, { status: 400 });
      throw error;
    }
  });
}
