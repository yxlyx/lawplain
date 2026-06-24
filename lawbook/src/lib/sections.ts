export interface Block {
  key: string;
  kind: "heading" | "numbered" | "para";
  num?: string;
  body: string;
  sectionId?: string;
}

const CANONICAL_HEADINGS = new Set([
  "analysis",
  "background",
  "conclusion",
  "costs",
  "decision",
  "facts",
  "introduction",
  "issues",
  "judgment",
  "orders",
  "procedural history",
  "reasons",
  "relief",
  "submissions",
  "the facts",
  "the law",
  "the parties",
]);

function isLikelyHeading(body: string): boolean {
  const normalized = body.replace(/\s+/g, " ").trim();
  if (
    normalized.length > 60 ||
    !/^[A-Z]/.test(normalized) ||
    /^\d/.test(normalized) ||
    /[.;:,?]$/.test(normalized)
  ) {
    return false;
  }

  // Avoid treating enumerated evidence/list items as section headings, e.g.
  // "(a) [SI], [PH] and [TJ] ..." or "Diameter – 30 cm and above".
  if (/^\([a-z0-9]+\)\s/i.test(normalized)) return false;
  if (/[–—-]\s*\d/.test(normalized)) return false;
  if (/\b(?:cm|mm|kg|sqm|species|diameter)\b/i.test(normalized)) return false;

  const lower = normalized.toLowerCase();
  if (CANONICAL_HEADINGS.has(lower)) return true;

  // Accept all-caps headings like "ISSUES TO CONSIDER", but not bracket-heavy
  // acronym/list fragments.
  const words = normalized.match(/[A-Za-z]+/g) ?? [];
  if (words.length === 0) return false;
  const hasLowercase = /[a-z]/.test(normalized);
  const bracketCount = (normalized.match(/[\][[]/g) ?? []).length;
  if (!hasLowercase && words.join("").length >= 3 && bracketCount === 0) {
    return true;
  }

  // Accept short title-case headings such as "Contract Formation". This is
  // intentionally stricter than "starts with capital" to avoid pulling random
  // sentence fragments into the nav.
  const titleWords = words.filter((word) => /^[A-Z]/.test(word));
  return (
    words.length <= 4 &&
    titleWords.length >= 2 &&
    titleWords.length === words.length
  );
}

/** Slug: lowercase, collapse non-alphanumerics to single hyphens, trim, cap. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
}

/**
 * The raw body_text wraps lines with stray single newlines and separates
 * paragraphs with blank lines. We split on blank lines, rejoin wrapped lines,
 * then classify each block so numbered paragraphs and section headings render
 * legibly instead of as one pre-wrapped slab.
 */
export function parseBlocks(text: string): Block[] {
  const seen = new Map<string, number>();
  return text
    .split(/\n[^\S\n]*\n+/)
    .map((raw) => raw.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean)
    .map((body, index): Block => {
      const prefix = body.slice(0, 40);
      const occ = seen.get(prefix) ?? 0;
      seen.set(prefix, occ + 1);
      const key = `${prefix}#${occ}`;

      const numbered = body.match(/^(\d+)[.)]?\s+([\s\S]+)$/);
      if (numbered) {
        return {
          key,
          kind: "numbered" as const,
          num: numbered[1],
          body: numbered[2],
        };
      }
      // Headings: short, label-like blocks, not ordinary short prose.
      if (isLikelyHeading(body)) {
        return {
          key,
          kind: "heading" as const,
          body,
          sectionId: `sec-${index}-${slugify(body)}`,
        };
      }
      return { key, kind: "para" as const, body };
    });
}

export function parseTerms(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .map((t) => t.trim())
        .filter((t) => t.length >= 2),
    ),
  );
}

export function buildRegex(terms: string[]): RegExp | null {
  if (terms.length === 0) return null;
  const escaped = terms
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .sort((a, b) => b.length - a.length);
  return new RegExp(`(${escaped.join("|")})`, "giu");
}

export interface DocSection {
  id: string;
  label: string;
}

/** One entry per heading block, in document order. */
export function extractSections(text: string): DocSection[] {
  const out: DocSection[] = [];
  for (const block of parseBlocks(text)) {
    if (block.kind === "heading" && block.sectionId) {
      out.push({ id: block.sectionId, label: block.body });
    }
  }
  return out;
}
