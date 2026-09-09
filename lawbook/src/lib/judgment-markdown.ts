import type { JudgmentDetail } from "./sgjudge";

export const JUDGMENT_TEXT_CHUNK = 60000;

export function parseTextOffset(value: string | null): number | null {
  if (value === null) return 0;
  if (!/^\d+$/.test(value)) return null;
  const offset = Number(value);
  return Number.isSafeInteger(offset) && offset <= 10_000_000 ? offset : null;
}

export function judgmentMarkdown(
  j: JudgmentDetail,
  citation: string,
  origin: string,
) {
  const path = `/judgment/${encodeURIComponent(citation)}`;
  const start = j.body_offset ?? 0;
  const body = j.body_text ?? "";
  // Backend uses SQLite length/substr: offsets count Unicode code points.
  const end = start + Array.from(body).length;
  const total = j.body_length ?? end;
  const line = (v: unknown) => String(v ?? "").replace(/[\r\n]+/g, " ");
  const next =
    end < total && body.length > 0
      ? `${origin}${path}/index.md?offset=${end}`
      : null;
  const text = [
    `# ${line(j.title || j.neutral_cite || citation)}`,
    "",
    `> Singapore judgment. Source text from Lawplain's public legal corpus; not an AI summary.`,
    "",
    `Citation: ${line(j.neutral_cite || j.citation || citation)}`,
    j.court ? `Court: ${line(j.court)}` : "",
    j.decision_date ? `Decision date: ${line(j.decision_date)}` : "",
    `Canonical page: ${origin}${path}`,
    j.url && /^https?:\/\//.test(j.url)
      ? `Official source: ${line(j.url)}`
      : "",
    "",
    `Text range: characters ${start}–${end} of ${total} (zero-based offsets).`,
    next
      ? `This is a partial text segment. [Continue reading](${next}).`
      : "End of available judgment text.",
    "",
    "## Judgment text",
    "",
    body,
    "",
    ...(next ? [`[Next text segment](${next})`, ""] : []),
  ]
    .filter((v) => v !== undefined)
    .join("\n");
  return { text, next, total };
}
