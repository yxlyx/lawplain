export interface Block {
  key: string;
  kind: "heading" | "numbered" | "para";
  num?: string;
  body: string;
  sectionId?: string;
  id?: string;
}

export interface DocSection {
  id: string;
  label: string;
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
    !/^[A-Z(]/.test(normalized) ||
    /^\d/.test(normalized) ||
    /[.;:,?]$/.test(normalized)
  ) {
    return false;
  }

  if (/^\([a-z0-9]+\)\s/i.test(normalized)) return false;
  if (/[–—-]\s*\d/.test(normalized)) return false;

  const lower = normalized.toLowerCase();
  if (CANONICAL_HEADINGS.has(lower)) return true;

  const words = normalized.match(/[A-Za-z]+/g) ?? [];
  if (words.length === 0) return false;
  const hasLowercase = /[a-z]/.test(normalized);
  const bracketCount = (normalized.match(/[\][[]/g) ?? []).length;
  if (!hasLowercase && words.join("").length >= 3 && bracketCount === 0) {
    return true;
  }

  const titleWords = words.filter((word) => /^[A-Z]/.test(word));
  return (
    words.length <= 4 &&
    titleWords.length >= 2 &&
    titleWords.length === words.length
  );
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
}

export function parseBlocks(text: string): Block[] {
  const seen = new Map<string, number>();
  const headingSeen = new Map<string, number>();
  const paragraphSeen = new Map<string, number>();

  return text
    .split(/\n[^\S\n]*\n+/)
    .map((raw) => raw.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean)
    .map((body): Block => {
      const prefix = body.slice(0, 40);
      const occ = seen.get(prefix) ?? 0;
      seen.set(prefix, occ + 1);
      const key = `${prefix}#${occ}`;

      const numbered = body.match(/^(\d+)[.)]?\s+([\s\S]+)$/);
      if (numbered) {
        const base = `p-${slugify(numbered[1]) || numbered[1]}`;
        const paragraphOcc = paragraphSeen.get(base) ?? 0;
        paragraphSeen.set(base, paragraphOcc + 1);
        return {
          key,
          kind: "numbered",
          num: numbered[1],
          body: numbered[2],
          id: paragraphOcc === 0 ? base : `${base}-${paragraphOcc + 1}`,
        };
      }

      if (isLikelyHeading(body)) {
        const base = `h-${slugify(body) || "heading"}`;
        const headingOcc = headingSeen.get(base) ?? 0;
        headingSeen.set(base, headingOcc + 1);
        return {
          key,
          kind: "heading",
          body,
          sectionId: headingOcc === 0 ? base : `${base}-${headingOcc + 1}`,
        };
      }

      return { key, kind: "para", body };
    });
}

export function extractSections(text: string): DocSection[] {
  return parseBlocks(text)
    .filter((block) => block.kind === "heading" && block.sectionId)
    .map((block) => ({ id: block.sectionId as string, label: block.body }));
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
