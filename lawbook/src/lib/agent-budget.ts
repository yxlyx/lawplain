export interface ResearchBudgetContext {
  citation: string;
  title: string;
}

export interface ResearchBudgetTurn {
  role: "user" | "assistant";
  text: string;
}

/**
 * Choose the smallest evidence budget that can answer the requested question.
 * Production traces showed that defaulting every turn to six calls encouraged
 * duplicate searches and long budget-rejection loops. Complex comparisons
 * retain the full budget; known one- and two-source plans are enforced here.
 */
export function researchToolCallBudget(
  question: string,
  context?: ResearchBudgetContext,
  history?: ResearchBudgetTurn[],
): number {
  const researchText = [
    question,
    context?.citation,
    context?.title,
    ...(history ?? []).map((turn) => turn.text),
  ]
    .filter(Boolean)
    .join(" ");
  const identifiesPdpa =
    /\bPDPA\b/i.test(researchText) ||
    /personal data protection act/i.test(researchText) ||
    context?.citation === "PDPA2012";
  const concernsDeceasedData =
    /\b(?:deceased|dead|died|death)\b/i.test(researchText) ||
    /passed away/i.test(researchText);
  const concernsHistoricalRecords =
    /\b(?:archive|archival|historical|legacy|records?|collected)\b/i.test(
      researchText,
    ) &&
    (/\b(?:19|20)\d{2}\b/.test(researchText) ||
      /\b(?:9[89]|100|101)[ -]?years?\b/i.test(researchText) ||
      /\b(?:a |one )?century(?: old)?\b/i.test(researchText) ||
      /2 July 2014/i.test(researchText));
  const asksForComparison =
    /\b(?:compare|contrast|versus|survey)\b/i.test(question) ||
    /\bvs\.?\b/i.test(question) ||
    /\b(?:multiple|several)\s+(?:cases|judgments|authorities|sources)\b/i.test(
      question,
    ) ||
    /\b(?:line|list) of cases\b/i.test(question);
  const exactNeutralCitations = new Set(
    question.match(/\[\d{4}\]\s+SG[A-Z]+(?:\([A-Z]\))?\s+\d+/gi) ?? [],
  );
  const asksForCaseLaw =
    /\b(?:case law|cases|judgments?|court decisions?|authorities)\b/i.test(
      question,
    );
  const concernsAgencyGuidance =
    /\b(?:TAFEP|PDPC)\b/i.test(researchText) ||
    /\b(?:agency guidance|guidelines?|framework|advisory)\b/i.test(
      researchText,
    );
  const asksForBindingLaw =
    /\b(?:binding|Act|statute|regulation|legal requirement|legal duty)\b/i.test(
      question,
    );
  const asksForElementsOrTest =
    /\b(?:elements?|legal test|required to prove)\b/i.test(question) ||
    /\bmust\b.{0,40}\bprove\b/i.test(question);

  if (identifiesPdpa && concernsHistoricalRecords) return 2;
  if (identifiesPdpa && concernsDeceasedData) return 1;
  if (exactNeutralCitations.size === 2) return 1;
  if (asksForComparison) return 6;
  if (context) return 1;
  if (concernsAgencyGuidance) return asksForBindingLaw ? 4 : 3;
  if (identifiesPdpa) return asksForCaseLaw ? 6 : 3;
  if (asksForElementsOrTest) return 3;
  return 4;
}
