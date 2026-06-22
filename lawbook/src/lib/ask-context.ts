/**
 * Build a ChatContext for the /ask page from a citation/reference + kind.
 * Fetches the document server-side and trims its body/sections into an
 * excerpt the agent can answer about without a re-fetch.
 *
 * Returns null if the document can't be loaded (the page degrades to a
 * context-less chat rather than 404-ing — /ask works on its own too).
 */
import type { ChatContext } from "@/lib/agent";
import { sgjudge } from "@/lib/sgjudge";

/** Cap the excerpt so the preamble doesn't dominate the context window. */
const MAX_EXCERPT = 6000;

function trim(s: string, max: number): string {
  const clean = s.replace(/\s{3,}/g, "\n\n").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export async function loadChatContext(
  params: URLSearchParams,
): Promise<ChatContext | null> {
  const cite = params.get("cite");
  const kind = params.get("kind");
  if (!cite || (kind !== "judgment" && kind !== "statute")) return null;

  try {
    if (kind === "judgment") {
      const j = await sgjudge.getJudgment(
        cite,
        { include_body: true, body_length: MAX_EXCERPT },
        { cache: "no-store" },
      );
      const canonical = j.citation || cite;
      const title = j.title || j.neutral_cite || canonical;
      const head = [
        `Court: ${j.court ?? "—"}`,
        `Year: ${j.year ?? "—"}`,
        `Neutral citation: ${j.neutral_cite ?? "—"}`,
        j.catchwords_json ? `Catchwords: ${j.catchwords_json}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      return {
        kind: "judgment",
        citation: canonical,
        title,
        href: `/judgment/${encodeURIComponent(canonical)}`,
        excerpt: trim(`${head}\n\n${j.body_text ?? ""}`, MAX_EXCERPT),
      };
    }

    const s = await sgjudge.getStatute(
      cite,
      { include_body: true },
      { cache: "no-store" },
    );
    const title = s.short_title || cite;
    const sections = (s.sections ?? [])
      .map((sec) => {
        const h = sec.heading ? ` — ${sec.heading}` : "";
        return `## ${sec.section_no}${h}\n${sec.text ?? ""}`;
      })
      .join("\n\n");
    return {
      kind: "statute",
      citation: cite,
      title,
      href: `/statute/${encodeURIComponent(cite)}`,
      excerpt: trim(sections, MAX_EXCERPT),
    };
  } catch {
    return null;
  }
}
