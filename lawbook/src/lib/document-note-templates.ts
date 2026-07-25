/**
 * Optional scaffolding for a document note (#194).
 *
 * A template is a set of headings, never a set of required fields: the note is
 * always one free-text body, and the template only seeds headings into it. That
 * keeps the promise in #194 that switching modes cannot silently discard text —
 * applying a template appends the headings a note is missing and leaves every
 * character the reader already wrote exactly where it was.
 */
import type { SavedDocType } from "@/lib/saved-workspace";

export interface DocumentNoteTemplate {
  /** Stored on the note. Stable and never localised. */
  id: string;
  name: string;
  /** Which document kinds offer this template first. */
  docTypes: readonly SavedDocType[];
  /** Empty for the free-form mode. */
  headings: readonly string[];
}

export const FREE_FORM_TEMPLATE_ID = "free";

export const DOCUMENT_NOTE_TEMPLATES: readonly DocumentNoteTemplate[] = [
  {
    id: FREE_FORM_TEMPLATE_ID,
    name: "Free form",
    docTypes: ["judgment", "statute"],
    headings: [],
  },
  {
    id: "case-brief",
    name: "Case brief",
    docTypes: ["judgment"],
    headings: [
      "Issue",
      "Key facts",
      "Holding / rule",
      "Court's reasoning",
      "My analysis",
      "Authorities to follow up",
    ],
  },
  {
    id: "statute-brief",
    name: "Statute brief",
    docTypes: ["statute"],
    headings: [
      "Purpose / scope",
      "Key definitions",
      "Duties / prohibitions",
      "Tests / thresholds",
      "Exceptions",
      "Remedies / penalties",
      "Cross-references / questions",
    ],
  },
];

/** Mirrors the CHECK constraint in migrations/0022_document_notes.sql. */
export const MAX_DOCUMENT_NOTE_TEMPLATE_ID_LENGTH = 64;

export function isDocumentNoteTemplateId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    DOCUMENT_NOTE_TEMPLATES.some((template) => template.id === value)
  );
}

/**
 * Never throws and never hides a note. A template id this release does not know
 * still resolves, so the note stays readable and editable instead of vanishing.
 */
export function resolveDocumentNoteTemplate(id: string): DocumentNoteTemplate {
  return (
    DOCUMENT_NOTE_TEMPLATES.find((template) => template.id === id) ?? {
      id,
      name: "Other template",
      docTypes: ["judgment", "statute"],
      headings: [],
    }
  );
}

export function templatesForDocType(
  docType: SavedDocType,
): readonly DocumentNoteTemplate[] {
  return DOCUMENT_NOTE_TEMPLATES.filter((template) =>
    template.docTypes.includes(docType),
  );
}

function headingLine(heading: string): string {
  return `## ${heading}`;
}

/**
 * Add only the headings this note does not already carry, appending them after
 * the existing text. Nothing the reader wrote is moved, reordered, or removed,
 * so applying a template is always safe and always reversible by hand.
 */
export function applyTemplate(body: string, templateId: string): string {
  const { headings } = resolveDocumentNoteTemplate(templateId);
  if (headings.length === 0) return body;
  const existing = new Set(
    body
      .split("\n")
      .map((line) =>
        line
          .trim()
          .replace(/^#+\s*/, "")
          .toLowerCase(),
      )
      .filter(Boolean),
  );
  const missing = headings.filter(
    (heading) => !existing.has(heading.toLowerCase()),
  );
  if (missing.length === 0) return body;
  const scaffold = missing.map((h) => `${headingLine(h)}\n\n`).join("");
  const trimmed = body.replace(/\s+$/, "");
  return trimmed ? `${trimmed}\n\n${scaffold}` : scaffold;
}

/** True when the body holds nothing but a template's own headings. */
export function isScaffoldOnly(body: string): boolean {
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 && lines.every((line) => line.startsWith("#"));
}
