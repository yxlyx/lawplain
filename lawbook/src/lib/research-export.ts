/**
 * Copy and export private research (#198).
 *
 * Pure formatting, so every privacy rule here is executed in tests rather than
 * reasoned about. Two rules matter more than the rest:
 *
 *   1. A private note is included only when the caller explicitly asks. The
 *      default for every function in this module is to leave it out.
 *   2. Quotation and commentary stay structurally distinct in the output, so a
 *      pasted quote can never read as if the court wrote the reader's note.
 */
export interface ExportAnnotation {
  annotationId: string;
  exactText: string;
  note: string | null;
  label: string;
  path: string;
  startOffset: number;
  endOffset: number;
  createdAt: number;
  updatedAt: number;
}

export interface ExportDocument {
  docType: "judgment" | "statute";
  docId: string;
  title: string;
  citation: string;
  path: string;
  savedAt: number | null;
  documentNote: { body: string; template: string; updatedAt: number } | null;
  annotations: ExportAnnotation[];
  tags: string[];
  collections: string[];
}

export interface CopyOptions {
  /** Off by default. The reader's note is theirs, not part of the citation. */
  includeNote?: boolean;
  /** Absolute origin, so a pasted link works outside the app. */
  origin?: string;
}

/** Human-readable label name, resolved by the caller so this stays pure. */
export interface LabelNames {
  [id: string]: string;
}

function deepLink(path: string, origin?: string): string {
  return origin ? `${origin}${path}` : path;
}

/**
 * One passage, ready to paste into a document: the quotation, its source, and —
 * only when chosen — the reader's own note, under its own heading.
 */
export function formatCopiedQuote(
  document: Pick<ExportDocument, "title" | "citation">,
  annotation: ExportAnnotation,
  labels: LabelNames,
  options: CopyOptions = {},
): string {
  const lines = [
    `"${annotation.exactText.replace(/\s+/g, " ").trim()}"`,
    "",
    `— ${document.title}${document.citation ? `, ${document.citation}` : ""}`,
    deepLink(annotation.path, options.origin),
  ];
  const labelName = labels[annotation.label] ?? annotation.label;
  lines.push(`Label: ${labelName}`);
  // The note is opt-in, and when present it is clearly the reader's, not the
  // court's — a pasted quote must never blur the two.
  if (options.includeNote && annotation.note) {
    lines.push("", `My note: ${annotation.note}`);
  }
  return lines.join("\n");
}

export interface ExportOptions {
  /** Off by default, for both passage notes and document notes. */
  includeNotes?: boolean;
  origin?: string;
  /** Stamped by the caller; this module never reads the clock. */
  generatedAt: number;
}

const SCHEMA_VERSION = 1;

/**
 * Machine-readable export. `sourceText` and `userNote` are separate keys, and the
 * schema is versioned so a later shape change is detectable rather than silent.
 */
export function toExportJson(
  documents: ExportDocument[],
  options: ExportOptions,
) {
  return {
    schema: "lawplain.private-research",
    schemaVersion: SCHEMA_VERSION,
    generatedAt: options.generatedAt,
    notesIncluded: Boolean(options.includeNotes),
    documents: documents.map((doc) => ({
      docType: doc.docType,
      docId: doc.docId,
      title: doc.title,
      citation: doc.citation,
      url: deepLink(doc.path, options.origin),
      savedAt: doc.savedAt,
      tags: doc.tags,
      collections: doc.collections,
      documentNote:
        options.includeNotes && doc.documentNote
          ? {
              userNote: doc.documentNote.body,
              template: doc.documentNote.template,
              updatedAt: doc.documentNote.updatedAt,
            }
          : null,
      annotations: doc.annotations.map((annotation) => ({
        annotationId: annotation.annotationId,
        label: annotation.label,
        url: deepLink(annotation.path, options.origin),
        startOffset: annotation.startOffset,
        endOffset: annotation.endOffset,
        // Verbatim source, always. The reader's words, only on request.
        sourceText: annotation.exactText,
        userNote: options.includeNotes ? annotation.note : null,
        createdAt: annotation.createdAt,
        updatedAt: annotation.updatedAt,
      })),
    })),
  };
}

function escapeMarkdown(value: string): string {
  // Only what would break structure: a note beginning "# " must not become a
  // heading, and a stray backtick must not open a code span.
  return value.replace(/^(\s*)([#>-])/gm, "$1\\$2").replace(/`/g, "\\`");
}

/**
 * Markdown export. Quotations are blockquotes; the reader's notes sit under an
 * explicit "My note" heading, so structure alone distinguishes them.
 */
export function toExportMarkdown(
  documents: ExportDocument[],
  labels: LabelNames,
  options: ExportOptions,
): string {
  const out: string[] = ["# My research", ""];
  if (documents.length === 0) {
    out.push("_Nothing saved yet._", "");
    return out.join("\n");
  }
  for (const doc of documents) {
    out.push(`## ${doc.title}`, "");
    if (doc.citation) out.push(`**Citation:** ${doc.citation}`, "");
    out.push(`**Source:** ${deepLink(doc.path, options.origin)}`, "");
    if (doc.collections.length > 0)
      out.push(`**Collections:** ${doc.collections.join(", ")}`, "");
    if (doc.tags.length > 0) out.push(`**Tags:** ${doc.tags.join(", ")}`, "");

    if (options.includeNotes && doc.documentNote) {
      out.push(
        "### My note on this document",
        "",
        escapeMarkdown(doc.documentNote.body),
        "",
      );
    }
    if (doc.annotations.length > 0) {
      out.push("### Passages", "");
      for (const annotation of doc.annotations) {
        const labelName = labels[annotation.label] ?? annotation.label;
        out.push(`**${labelName}**`, "");
        for (const line of annotation.exactText.split("\n"))
          out.push(`> ${line}`);
        out.push("", deepLink(annotation.path, options.origin), "");
        if (options.includeNotes && annotation.note) {
          out.push(`_My note:_ ${escapeMarkdown(annotation.note)}`, "");
        }
      }
    }
  }
  return out.join("\n");
}

/** A filename that cannot escape a directory or carry a surprising extension. */
export function exportFilename(
  scope: string,
  format: "md" | "json",
  generatedAt: number,
): string {
  const safe = scope.replace(/[^a-zA-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  const date = new Date(generatedAt).toISOString().slice(0, 10);
  return `lawplain-${safe || "research"}-${date}.${format}`;
}
