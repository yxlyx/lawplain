export type CitationKind = "judgment" | "statute";
export type CitationFormat = "legal" | "apa7" | "mla" | "chicago";

export interface CitationSource {
  kind: CitationKind;
  title?: string | null;
  citation?: string | null;
  reference?: string | null;
  pinpoint?: string | null;
  court?: string | null;
  date?: string | null;
  year?: number | string | null;
  url?: string | null;
}

export const CITATION_FORMAT_LABELS: Record<CitationFormat, string> = {
  legal: "Legal",
  apa7: "APA 7",
  mla: "MLA",
  chicago: "Chicago",
};

export interface FormattedCitation {
  plain: string;
  html: string;
}

export function formatCitation(
  source: CitationSource,
  format: CitationFormat = "legal",
): FormattedCitation {
  return source.kind === "statute"
    ? formatStatuteCitation(source, format)
    : formatJudgmentCitation(source, format);
}

export function citationLabel(source: CitationSource): string {
  return formatCitation(source, "legal").plain;
}

export function citationText(source: CitationSource): string {
  return citationLabel(source);
}

function formatJudgmentCitation(
  source: CitationSource,
  format: CitationFormat,
): FormattedCitation {
  const title = source.title || source.citation || "Judgment";
  const cite =
    source.citation && source.citation !== title ? source.citation : "";
  const pinpoint = source.pinpoint || "";
  const courtDate = joinNonEmpty([source.court, source.date], ", ");

  switch (format) {
    case "apa7": {
      const plain = `${joinNonEmpty([title, cite, pinpoint], ", ")}${courtDate ? ` (${courtDate})` : ""}.`;
      const html = `${joinNonEmpty([italic(title), escapeHtml(cite), escapeHtml(pinpoint)], ", ")}${courtDate ? ` (${escapeHtml(courtDate)})` : ""}.`;
      return cleanCitation({ plain, html });
    }
    case "mla": {
      const plain = `${title}. ${joinNonEmpty([cite, source.court, source.date], ". ")}${pinpoint ? `, ${pinpoint}` : ""}.`;
      const html = `${italic(title)}. ${joinNonEmpty([escapeHtml(cite), escapeHtml(source.court), escapeHtml(source.date)], ". ")}${pinpoint ? `, ${escapeHtml(pinpoint)}` : ""}.`;
      return cleanCitation({ plain, html });
    }
    case "chicago": {
      const plain = `${joinNonEmpty([title, cite], ", ")}${courtDate ? ` (${courtDate})` : ""}${pinpoint ? `, ${pinpoint}` : ""}.`;
      const html = `${joinNonEmpty([italic(title), escapeHtml(cite)], ", ")}${courtDate ? ` (${escapeHtml(courtDate)})` : ""}${pinpoint ? `, ${escapeHtml(pinpoint)}` : ""}.`;
      return cleanCitation({ plain, html });
    }
    default: {
      const plain = joinNonEmpty([title, cite, pinpoint], ", ");
      const html = joinNonEmpty(
        [italic(title), escapeHtml(cite), escapeHtml(pinpoint)],
        ", ",
      );
      return cleanCitation({ plain, html });
    }
  }
}

function formatStatuteCitation(
  source: CitationSource,
  format: CitationFormat,
): FormattedCitation {
  const title = source.title || source.reference || "Statute";
  const ref =
    source.reference && source.reference !== title ? source.reference : "";
  const year = source.year ? String(source.year) : "";
  const pinpoint = source.pinpoint || "";

  switch (format) {
    case "apa7": {
      const plain = `${joinNonEmpty([title, ref, pinpoint], ", ")}${year ? ` (${year})` : ""}.`;
      const html = `${joinNonEmpty([escapeHtml(title), escapeHtml(ref), escapeHtml(pinpoint)], ", ")}${year ? ` (${escapeHtml(year)})` : ""}.`;
      return cleanCitation({ plain, html });
    }
    case "mla": {
      const plain = `${title}. ${joinNonEmpty([ref, year, pinpoint], ", ")}.`;
      const html = `${italic(title)}. ${joinNonEmpty([escapeHtml(ref), escapeHtml(year), escapeHtml(pinpoint)], ", ")}.`;
      return cleanCitation({ plain, html });
    }
    case "chicago": {
      const plain = `${joinNonEmpty([title, ref], ", ")}${year ? ` (${year})` : ""}${pinpoint ? `, ${pinpoint}` : ""}.`;
      const html = `${joinNonEmpty([escapeHtml(title), escapeHtml(ref)], ", ")}${year ? ` (${escapeHtml(year)})` : ""}${pinpoint ? `, ${escapeHtml(pinpoint)}` : ""}.`;
      return cleanCitation({ plain, html });
    }
    default: {
      const yearPart = year && ref ? `${ref}, ${year}` : ref || year;
      const plain = joinNonEmpty(
        [title, yearPart ? `(${yearPart})` : "", pinpoint],
        ", ",
      );
      const html = joinNonEmpty(
        [
          escapeHtml(title),
          yearPart ? `(${escapeHtml(yearPart)})` : "",
          escapeHtml(pinpoint),
        ],
        ", ",
      );
      return cleanCitation({ plain, html });
    }
  }
}

function cleanCitation(citation: FormattedCitation): FormattedCitation {
  return {
    plain: citation.plain
      .replace(/\s+([,.)])/g, "$1")
      .replace(/\s+/g, " ")
      .trim(),
    html: citation.html
      .replace(/\s+([,.)])/g, "$1")
      .replace(/\s+/g, " ")
      .trim(),
  };
}

function joinNonEmpty(
  values: Array<string | null | undefined>,
  separator: string,
): string {
  return values
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(separator);
}

function italic(value: string): string {
  return `<i>${escapeHtml(value)}</i>`;
}

function escapeHtml(value?: string | null): string {
  return (value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function judgmentPinpointLabel(paragraph: string): string {
  return `[${paragraph}]`;
}

export function headingPinpointLabel(heading: string): string {
  return heading;
}

export function statuteSectionPinpointLabel(sectionNo: string): string {
  return `s ${sectionNo}`;
}
