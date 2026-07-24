/**
 * Legal annotation labels (#193 foundation).
 *
 * Colour is a visual aid, never the label itself: every surface that paints a
 * label's colour must also render its `name`. This phase ships one universal
 * preset — the case-reading set from #193 — for both judgments and statutes.
 * Statute-specific presets, renaming, recolouring, and user-defined labels are
 * #193 proper; the storage column is deliberately open-ended so they can land
 * without a migration that rewrites existing annotations.
 */
export interface AnnotationLabel {
  /** Stored on the annotation. Stable and never localised. */
  id: string;
  /** Always displayed wherever the colour appears. */
  name: string;
  /** Short guidance shown beside the name in the palette. */
  hint: string;
}

export const ANNOTATION_LABELS: readonly AnnotationLabel[] = [
  { id: "key-point", name: "Key point", hint: "Generally important passage" },
  {
    id: "facts",
    name: "Facts / Procedure",
    hint: "Material facts or procedural history",
  },
  { id: "issue", name: "Issue", hint: "Question before the court" },
  {
    id: "holding",
    name: "Rule / Holding",
    hint: "Legal rule, ratio, or conclusion",
  },
  { id: "reasoning", name: "Reasoning", hint: "Application and analysis" },
  {
    id: "exception",
    name: "Exception / Counterpoint",
    hint: "Qualification, distinction, dissent, or opposing view",
  },
  { id: "follow-up", name: "Follow up", hint: "Citation or issue to check" },
];

/** A plain Highlight with no explicit choice, and the migration's backfill. */
export const DEFAULT_ANNOTATION_LABEL_ID = "key-point";

/** Mirrors the CHECK constraint in migrations/0021_annotation_labels.sql. */
export const MAX_ANNOTATION_LABEL_ID_LENGTH = 64;

export function isAnnotationLabelId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ANNOTATION_LABELS.some((label) => label.id === value)
  );
}

/**
 * Never throws and never hides an annotation. An id this release does not know
 * — a user-defined label from #193, or one archived after the annotation was
 * written — still resolves to a readable name so the passage stays visible and
 * editable rather than disappearing from the document.
 */
export function resolveAnnotationLabel(id: string): AnnotationLabel {
  return (
    ANNOTATION_LABELS.find((label) => label.id === id) ?? {
      id,
      name: "Other label",
      hint: "Saved with a label this view does not recognise",
    }
  );
}

/**
 * CSS custom-property and ::highlight() suffix for a label. Unknown ids share
 * the neutral treatment so an unrecognised label is still visible in the text.
 */
export function annotationLabelToken(id: string): string {
  return isAnnotationLabelId(id) ? id : "other";
}
