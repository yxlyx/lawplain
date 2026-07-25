/**
 * Annotation-based outlines and authority comparison (#201).
 *
 * Pure: an outline is a *view* over annotations, assembled and reordered without
 * ever writing back. That is the property #201 asks for and the one worth making
 * structural — nothing in this module can mutate a source annotation, because
 * nothing in this module touches the database at all.
 *
 * No AI is involved. Grouping, ordering and comparison are all deterministic.
 */
import type {
  ExportAnnotation,
  ExportDocument,
  LabelNames,
} from "@/lib/research-export";

export type OutlineGrouping = "label" | "authority" | "tag" | "collection";

export interface OutlineExcerpt {
  /** Identifies the source annotation. Never rewritten by outline editing. */
  annotationId: string;
  /** Verbatim from the authority. */
  sourceText: string;
  /** The reader's own words, kept separate at every stage. */
  userNote: string | null;
  label: string;
  labelName: string;
  /** Full authority metadata travels with every excerpt. */
  docType: "judgment" | "statute";
  docId: string;
  title: string;
  citation: string;
  /** Deep link back to the original passage. */
  url: string;
}

export interface OutlineSection {
  heading: string;
  excerpts: OutlineExcerpt[];
}

export interface Outline {
  grouping: OutlineGrouping;
  sections: OutlineSection[];
  /** Set when a chosen scope produced nothing, so the caller can say why. */
  emptyReason: string | null;
}

export interface OutlineScope {
  grouping?: OutlineGrouping;
  /** Only these labels, in this order, when given. */
  labels?: string[];
  /** Only these annotation ids, when the reader picked passages by hand. */
  annotationIds?: string[];
  origin?: string;
}

function excerptFrom(
  doc: ExportDocument,
  annotation: ExportAnnotation,
  labels: LabelNames,
  origin?: string,
): OutlineExcerpt {
  return {
    annotationId: annotation.annotationId,
    sourceText: annotation.exactText,
    userNote: annotation.note,
    label: annotation.label,
    labelName: labels[annotation.label] ?? annotation.label,
    docType: doc.docType,
    docId: doc.docId,
    title: doc.title,
    citation: doc.citation,
    url: origin ? `${origin}${annotation.path}` : annotation.path,
  };
}

/**
 * Collect annotations into an outline. Sections come out in a stable order:
 * the reader's chosen label order when given, otherwise first-seen order, so the
 * same inputs always produce the same outline.
 */
export function buildOutline(
  documents: ExportDocument[],
  labels: LabelNames,
  scope: OutlineScope = {},
): Outline {
  const grouping = scope.grouping ?? "label";
  const chosen = scope.annotationIds ? new Set(scope.annotationIds) : null;
  const wanted = scope.labels && scope.labels.length > 0 ? scope.labels : null;

  const excerpts: OutlineExcerpt[] = [];
  for (const doc of documents) {
    for (const annotation of doc.annotations) {
      if (chosen && !chosen.has(annotation.annotationId)) continue;
      if (wanted && !wanted.includes(annotation.label)) continue;
      excerpts.push(excerptFrom(doc, annotation, labels, scope.origin));
    }
  }

  if (excerpts.length === 0) {
    return {
      grouping,
      sections: [],
      emptyReason: wanted
        ? "None of your highlights carry the labels you chose."
        : chosen
          ? "The passages you selected are no longer in your research."
          : "You have no highlighted passages yet.",
    };
  }

  const keyed = new Map<string, OutlineExcerpt[]>();
  const keyOf = (excerpt: OutlineExcerpt): string[] => {
    switch (grouping) {
      case "authority":
        return [
          excerpt.citation
            ? `${excerpt.title} (${excerpt.citation})`
            : excerpt.title,
        ];
      case "tag":
      case "collection": {
        const doc = documents.find((d) => d.docId === excerpt.docId);
        const names = grouping === "tag" ? doc?.tags : doc?.collections;
        // An excerpt in no group still belongs somewhere, rather than vanishing.
        return names && names.length > 0 ? names : ["Ungrouped"];
      }
      default:
        return [excerpt.labelName];
    }
  };

  // Seed sections in the reader's chosen label order so an empty chosen label
  // still shows as a heading rather than silently disappearing.
  if (grouping === "label" && wanted) {
    for (const id of wanted) keyed.set(labels[id] ?? id, []);
  }
  for (const excerpt of excerpts) {
    for (const key of keyOf(excerpt)) {
      const list = keyed.get(key) ?? [];
      list.push(excerpt);
      keyed.set(key, list);
    }
  }

  return {
    grouping,
    sections: [...keyed.entries()].map(([heading, list]) => ({
      heading,
      excerpts: list,
    })),
    emptyReason: null,
  };
}

/**
 * Move one excerpt within its section. Returns a new outline; the source
 * annotation is untouched, because an outline never owns the annotation.
 */
export function reorderExcerpt(
  outline: Outline,
  heading: string,
  from: number,
  to: number,
): Outline {
  const sections = outline.sections.map((section) => {
    if (section.heading !== heading) return section;
    if (
      from < 0 ||
      to < 0 ||
      from >= section.excerpts.length ||
      to >= section.excerpts.length
    )
      return section;
    const excerpts = [...section.excerpts];
    const [moved] = excerpts.splice(from, 1);
    excerpts.splice(to, 0, moved);
    return { ...section, excerpts };
  });
  return { ...outline, sections };
}

export interface ComparisonRow {
  category: string;
  /** One cell per authority, in the order the authorities were given. */
  cells: Array<{
    title: string;
    citation: string;
    excerpts: OutlineExcerpt[];
  }>;
}

/** Categories a comparison offers, mapped to the labels that fill them. */
export const COMPARISON_CATEGORIES: ReadonlyArray<{
  category: string;
  labels: readonly string[];
}> = [
  { category: "Issue", labels: ["issue"] },
  { category: "Rule / Holding", labels: ["holding"] },
  { category: "Reasoning", labels: ["reasoning"] },
  { category: "Distinction", labels: ["exception"] },
  { category: "Facts", labels: ["facts"] },
];

/**
 * Compare two or more authorities side by side. A category with nothing in it for
 * one authority yields an empty cell rather than a missing column, so the table
 * stays rectangular and the gap is visible instead of misaligning the row.
 */
export function buildComparison(
  documents: ExportDocument[],
  labels: LabelNames,
  options: { origin?: string } = {},
): {
  authorities: Array<{ title: string; citation: string }>;
  rows: ComparisonRow[];
} {
  const authorities = documents.map((doc) => ({
    title: doc.title,
    citation: doc.citation,
  }));
  const rows: ComparisonRow[] = COMPARISON_CATEGORIES.map(
    ({ category, labels: wanted }) => ({
      category,
      cells: documents.map((doc) => ({
        title: doc.title,
        citation: doc.citation,
        excerpts: doc.annotations
          .filter((annotation) => wanted.includes(annotation.label))
          .map((annotation) =>
            excerptFrom(doc, annotation, labels, options.origin),
          ),
      })),
    }),
  );
  // A reader's own commentary belongs in the comparison too, but as its own row.
  rows.push({
    category: "My notes",
    cells: documents.map((doc) => ({
      title: doc.title,
      citation: doc.citation,
      excerpts: doc.annotations
        .filter((annotation) => Boolean(annotation.note))
        .map((annotation) =>
          excerptFrom(doc, annotation, labels, options.origin),
        ),
    })),
  });
  return { authorities, rows };
}

/**
 * Render an outline as Markdown. Source quotations are blockquotes and the
 * reader's commentary is not, matching the export format in #198 so a copied
 * outline reads the same way as an exported document.
 */
export function outlineToMarkdown(
  outline: Outline,
  options: { title?: string; includeNotes?: boolean } = {},
): string {
  const out: string[] = [`# ${options.title ?? "Research outline"}`, ""];
  if (outline.sections.length === 0) {
    out.push(`_${outline.emptyReason ?? "Nothing to outline."}_`, "");
    return out.join("\n");
  }
  for (const section of outline.sections) {
    out.push(`## ${section.heading}`, "");
    if (section.excerpts.length === 0) {
      out.push("_Nothing under this heading yet._", "");
      continue;
    }
    for (const excerpt of section.excerpts) {
      for (const line of excerpt.sourceText.split("\n")) out.push(`> ${line}`);
      out.push(
        "",
        `— ${excerpt.title}${excerpt.citation ? `, ${excerpt.citation}` : ""}`,
        excerpt.url,
        "",
      );
      if (options.includeNotes && excerpt.userNote) {
        out.push(`_My note:_ ${excerpt.userNote}`, "");
      }
    }
  }
  return out.join("\n");
}
