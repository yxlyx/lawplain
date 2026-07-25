/**
 * Consent for using private annotations with Ask (#200).
 *
 * Pure, so every rule here is executed in tests rather than trusted.
 *
 * The contract, in one sentence: private notes never reach a model unless *this*
 * request carries an explicit opt-in naming exactly what to include. There is no
 * stored preference, no remembered default, and no "always allow" — consent is
 * per request, so closing a dialog or reloading the page returns to off.
 */

/** What a request may draw on. Everything defaults to excluded. */
export interface AskConsent {
  /** Off unless the reader turned it on for this request. */
  includePrivateNotes: boolean;
  /** Exact annotation ids the reader chose. Empty means none. */
  annotationIds: string[];
  /** Include the document-level note for these authorities. Empty means none. */
  documentNoteAuthorityIds: string[];
}

export const NO_CONSENT: AskConsent = {
  includePrivateNotes: false,
  annotationIds: [],
  documentNoteAuthorityIds: [],
};

/** Bounds one request; a reader narrowing by hand never approaches this. */
export const MAX_CONSENTED_ITEMS = 100;

/**
 * Parse a client's claimed consent.
 *
 * Anything missing, malformed, or oversized yields NO_CONSENT rather than an
 * error, because failing closed is the safe direction: the worst outcome of a
 * parsing bug must be that private notes are left out, never that they are sent.
 */
export function normalizeConsent(value: unknown): AskConsent {
  if (!value || typeof value !== "object") return NO_CONSENT;
  const raw = value as Record<string, unknown>;
  // The opt-in must be literally true. A truthy string or 1 is not consent.
  if (raw.includePrivateNotes !== true) return NO_CONSENT;
  const ids = idList(raw.annotationIds);
  const authorityIds = idList(raw.documentNoteAuthorityIds);
  if (ids === null || authorityIds === null) return NO_CONSENT;
  if (ids.length + authorityIds.length === 0) return NO_CONSENT;
  if (ids.length + authorityIds.length > MAX_CONSENTED_ITEMS) return NO_CONSENT;
  return {
    includePrivateNotes: true,
    annotationIds: ids,
    documentNoteAuthorityIds: authorityIds,
  };
}

function idList(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item || item.length > 200) return null;
    if (!ids.includes(item)) ids.push(item);
  }
  return ids;
}

/** One item the reader is shown before sending. */
export interface ManifestItem {
  kind: "annotation" | "documentNote";
  id: string;
  title: string;
  citation: string;
  label: string | null;
  /** Verbatim from the authority. Null for a document note. */
  sourcePreview: string | null;
  /** The reader's own words — what the opt-in is actually about. */
  notePreview: string | null;
  hasNote: boolean;
}

export interface ContextManifest {
  items: ManifestItem[];
  annotationCount: number;
  documentNoteCount: number;
  /** True when at least one item would contribute the reader's own words. */
  includesNoteText: boolean;
  caveat: string;
}

export const LEGAL_CAVEAT =
  "This is legal information generated from your own research, not legal advice. " +
  "Check every passage against the source before relying on it.";

/**
 * Build the list shown before submission.
 *
 * The manifest is derived from the same rows the request will use, so what the
 * reader inspects is what gets sent — not a separate summary that could drift.
 */
export function buildManifest(
  items: ManifestItem[],
  consent: AskConsent,
): ContextManifest {
  const included = consent.includePrivateNotes ? items : [];
  return {
    items: included,
    annotationCount: included.filter((i) => i.kind === "annotation").length,
    documentNoteCount: included.filter((i) => i.kind === "documentNote").length,
    includesNoteText: included.some((i) => i.hasNote),
    caveat: LEGAL_CAVEAT,
  };
}

/** Provenance of one block of assembled context. */
export type Provenance = "source_law" | "user_note" | "generated";

export interface ContextBlock {
  provenance: Provenance;
  /** Stable reference so a generated claim can cite back to this block. */
  ref: string;
  citation: string;
  url: string;
  text: string;
}

/**
 * Assemble prompt context with provenance attached to every block.
 *
 * Source law and the reader's notes are separate blocks with separate labels, so a
 * model is never handed a paragraph where the two have already been merged — and
 * a generated claim can cite the block it came from.
 */
export function toContextBlocks(
  items: ManifestItem[],
  consent: AskConsent,
  urls: Record<string, string>,
): ContextBlock[] {
  if (!consent.includePrivateNotes) return [];
  const blocks: ContextBlock[] = [];
  for (const item of items) {
    if (item.sourcePreview) {
      blocks.push({
        provenance: "source_law",
        ref: `${item.id}:source`,
        citation: item.citation,
        url: urls[item.id] ?? "",
        text: item.sourcePreview,
      });
    }
    if (item.notePreview) {
      blocks.push({
        provenance: "user_note",
        ref: `${item.id}:note`,
        citation: item.citation,
        url: urls[item.id] ?? "",
        text: item.notePreview,
      });
    }
  }
  return blocks;
}

/**
 * Redact note text for logging.
 *
 * Ordinary application logs and analytics see counts and refs, never a word the
 * reader wrote. Used wherever a request is recorded.
 */
export function redactForLogs(blocks: ContextBlock[]) {
  return {
    blockCount: blocks.length,
    sourceLawBlocks: blocks.filter((b) => b.provenance === "source_law").length,
    userNoteBlocks: blocks.filter((b) => b.provenance === "user_note").length,
    // Refs identify rows the owner already has; they carry no note content.
    refs: blocks.map((b) => b.ref),
  };
}

/**
 * A generated claim must cite a block it was given. An uncited or unknown-ref
 * claim is reported rather than shown as though it were grounded.
 */
export function verifyClaimCitations(
  claims: Array<{ text: string; refs: string[] }>,
  blocks: ContextBlock[],
): { grounded: boolean; ungrounded: string[] } {
  const known = new Set(blocks.map((b) => b.ref));
  const ungrounded = claims
    .filter(
      (claim) =>
        claim.refs.length === 0 || claim.refs.some((ref) => !known.has(ref)),
    )
    .map((claim) => claim.text);
  return { grounded: ungrounded.length === 0, ungrounded };
}
