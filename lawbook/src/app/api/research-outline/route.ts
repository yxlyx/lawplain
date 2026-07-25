import {
  ANNOTATION_LABELS,
  isAnnotationLabelId,
} from "@/lib/annotation-labels";
import { getSession } from "@/lib/auth";
import { privateJson, privateRoute } from "@/lib/private-response";
import type { LabelNames } from "@/lib/research-export";
import { collectResearchForExport } from "@/lib/research-export-data";
import {
  buildComparison,
  buildOutline,
  type OutlineGrouping,
  outlineToMarkdown,
} from "@/lib/research-outline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LABEL_NAMES: LabelNames = Object.fromEntries(
  ANNOTATION_LABELS.map((label) => [label.id, label.name]),
);

const GROUPINGS: OutlineGrouping[] = [
  "label",
  "authority",
  "tag",
  "collection",
];

function isGrouping(value: string | null): value is OutlineGrouping {
  return GROUPINGS.includes(value as OutlineGrouping);
}

/**
 * Build an outline or a comparison from the reader's own annotations (#201).
 *
 * No AI: grouping and ordering are deterministic, and every excerpt keeps its
 * authority metadata and a deep link. Markdown is produced through the same path
 * as #198's export, so a copied outline reads like an exported document — and the
 * reader's notes are only included when explicitly asked for.
 */
export async function GET(req: Request): Promise<Response> {
  return privateRoute(async () => {
    const session = await getSession(req.headers);
    if (!session)
      return privateJson({ error: "Authentication required" }, { status: 401 });
    const params = new URL(req.url).searchParams;

    const rawGrouping = params.get("grouping");
    if (rawGrouping !== null && !isGrouping(rawGrouping))
      return privateJson({ error: "Invalid grouping" }, { status: 400 });

    const labels = params.getAll("label");
    if (labels.some((label) => !isAnnotationLabelId(label)))
      return privateJson({ error: "Invalid label" }, { status: 400 });

    const includeNotes = params.get("includeNotes") === "true";
    const mode = params.get("mode") === "compare" ? "compare" : "outline";

    const documents = await collectResearchForExport(session.user.id);
    const origin = new URL(req.url).origin;

    if (mode === "compare") {
      const comparison = buildComparison(documents, LABEL_NAMES, { origin });
      return privateJson(comparison);
    }

    // An empty list must mean "no hand-picked scope", not "pick nothing" — an
    // empty array is truthy, and would otherwise return an empty outline.
    const chosen = params.getAll("annotationId");
    const outline = buildOutline(documents, LABEL_NAMES, {
      grouping: rawGrouping ?? undefined,
      labels: labels.length > 0 ? labels : undefined,
      annotationIds: chosen.length > 0 ? chosen : undefined,
      origin,
    });

    if (params.get("format") === "md") {
      return privateJson({
        markdown: outlineToMarkdown(outline, {
          title: "Research outline",
          includeNotes,
        }),
      });
    }
    return privateJson(outline);
  });
}
