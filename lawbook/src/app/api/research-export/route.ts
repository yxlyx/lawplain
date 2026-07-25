import { ANNOTATION_LABELS } from "@/lib/annotation-labels";
import { getSession } from "@/lib/auth";
import {
  PRIVATE_RESPONSE_HEADERS,
  privateJson,
  privateRoute,
} from "@/lib/private-response";
import {
  exportFilename,
  type LabelNames,
  toExportJson,
  toExportMarkdown,
} from "@/lib/research-export";
import { collectResearchForExport } from "@/lib/research-export-data";
import { isSavedDocType } from "@/lib/saved-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LABEL_NAMES: LabelNames = Object.fromEntries(
  ANNOTATION_LABELS.map((label) => [label.id, label.name]),
);

/**
 * Export one document or the whole personal library.
 *
 * The response is generated per request and carries the same no-store headers as
 * every other private route, so nothing is left publicly addressable or cached —
 * there is no export file written anywhere to be found later.
 */
export async function GET(req: Request): Promise<Response> {
  return privateRoute(async () => {
    const session = await getSession(req.headers);
    if (!session)
      return privateJson({ error: "Authentication required" }, { status: 401 });
    const params = new URL(req.url).searchParams;

    const format = params.get("format") ?? "md";
    if (format !== "md" && format !== "json")
      return privateJson({ error: "Invalid format" }, { status: 400 });

    const rawType = params.get("docType");
    if (rawType !== null && !isSavedDocType(rawType))
      return privateJson({ error: "Invalid document type" }, { status: 400 });
    const docId = params.get("docId");
    if ((rawType === null) !== (docId === null))
      return privateJson(
        { error: "Give both docType and docId, or neither" },
        { status: 400 },
      );

    // Notes are opt-in here exactly as they are in the copy action.
    const includeNotes = params.get("includeNotes") === "true";
    const generatedAt = Date.now();
    const documents = await collectResearchForExport(session.user.id, {
      docType: rawType ?? undefined,
      docId: docId ?? undefined,
    });
    if (rawType && documents.length === 0)
      return privateJson({ error: "Nothing to export" }, { status: 404 });

    const origin = new URL(req.url).origin;
    const scope = rawType ? `${rawType}-${docId}` : "library";
    const filename = exportFilename(scope, format, generatedAt);
    const body =
      format === "json"
        ? JSON.stringify(
            toExportJson(documents, { includeNotes, origin, generatedAt }),
            null,
            2,
          )
        : toExportMarkdown(documents, LABEL_NAMES, {
            includeNotes,
            origin,
            generatedAt,
          });

    return new Response(body, {
      headers: {
        ...PRIVATE_RESPONSE_HEADERS,
        "content-type":
          format === "json"
            ? "application/json; charset=utf-8"
            : "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  });
}
