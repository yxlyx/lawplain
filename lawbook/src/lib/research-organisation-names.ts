/**
 * Pure naming rules for tags and collections (#197).
 *
 * Separate from research-organisation.ts, which touches D1, so these can be
 * executed in tests. Whitespace normalisation is what stops " Negligence " and
 * "Negligence" becoming two tags before the unique index ever sees them.
 */
export type OrganisationKind = "tag" | "collection";

export const MAX_TAG_NAME = 80;
export const MAX_COLLECTION_NAME = 120;
export const MAX_DESCRIPTION = 2_000;
/** Bounds a runaway client, not a real research habit. */
export const MAX_ITEMS_PER_KIND = 500;

export function isOrganisationKind(value: unknown): value is OrganisationKind {
  return value === "tag" || value === "collection";
}

/** Trim and collapse whitespace so " Negligence " and "Negligence" are one tag. */
export function normalizeGroupName(
  value: unknown,
  kind: OrganisationKind,
): string | null {
  if (typeof value !== "string") return null;
  const max = kind === "tag" ? MAX_TAG_NAME : MAX_COLLECTION_NAME;
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > max) return null;
  return cleaned;
}

/**
 * `null` means "no description". `undefined` means the input was unusable, so the
 * caller answers 400 rather than silently discarding what the reader typed.
 */
export function normalizeDescription(
  value: unknown,
): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim();
  if (cleaned.length > MAX_DESCRIPTION) return undefined;
  return cleaned || null;
}
