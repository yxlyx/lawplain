/**
 * Typed client for the sgjudge legal-corpus REST API.
 *
 * - Base: https://backend.lawplain.com
 * - Public, read-only (GET only), CORS `*` — safe to call from the browser.
 * - Search endpoints take `?q=` (required) and `?limit=` (default 10, max 50).
 * - `score` is SQLite FTS5 bm25(): negative, ascending = most relevant first.
 */
export const BASE = "https://backend.lawplain.com";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface SearchHit {
  score: number;
  snippet: string;
  [k: string]: unknown; // corpus-specific key columns
}

export interface SearchResponse<T extends SearchHit = SearchHit> {
  query: string;
  count: number;
  results: T[];
}

export interface JudgmentHit extends SearchHit {
  citation: string;
  neutral_cite?: string;
  court?: string;
  year?: number;
  title?: string;
  decision_date?: string;
}

export interface JudgmentSection {
  id?: string;
  label: string;
  level?: number;
  start_offset?: number;
  end_offset?: number;
  [k: string]: unknown;
}

export interface JudgmentDetail {
  citation: string;
  title?: string;
  court?: string;
  neutral_cite?: string;
  decision_date?: string;
  hearing_date?: string;
  case_no?: string;
  year?: number;
  judges_json?: string;
  counsel_json?: string;
  catchwords_json?: string;
  body_length: number;
  body_offset: number;
  body_text: string;
  sections?: JudgmentSection[];
  url?: string; // official eLitigation source
  [k: string]: unknown;
}

export interface StatuteHit extends SearchHit {
  act_id: string;
  kind?: string;
  short_title?: string;
  year_enacted?: number;
}

export interface StatuteSection {
  section_no: string;
  heading?: string;
  text?: string;
  body_text?: string;
  [k: string]: unknown;
}

export interface StatuteDetail {
  act_id: string;
  short_title?: string;
  kind?: string;
  year_enacted?: number;
  sections?: StatuteSection[];
  url?: string; // official Singapore Statutes Online source
  [k: string]: unknown;
}

export interface HansardHit extends SearchHit {
  speaker?: string;
  party?: string;
  constituency?: string;
  topic?: string;
  date?: string;
}

export interface BillHit extends SearchHit {
  session?: string;
  status?: string;
  title?: string;
}

export interface StatsResponse {
  counts: Record<string, number>;
  judgments_by_court: { court: string; n: number }[];
}

/** Generic full-detail document (hansard / bills / subsidiary / practice). */
export interface DocumentDetail {
  body_text?: string;
  body_offset?: number;
  body_length?: number;
  url?: string;
  [k: string]: unknown;
}

/** UI document kind -> backend resource path segment. */
export const DOCUMENT_KIND_PATHS: Record<string, string> = {
  hansard: "hansard",
  bills: "bills",
  subsidiary: "subsidiary-legislation",
  practice: "practice-directions",
};

export type DocumentKind = keyof typeof DOCUMENT_KIND_PATHS;

export function isDocumentKind(value: string): value is DocumentKind {
  return value in DOCUMENT_KIND_PATHS;
}

/* ------------------------------------------------------------------ */
/* Core fetcher                                                        */
/* ------------------------------------------------------------------ */

type Params = Record<string, string | number | boolean | undefined>;

async function get<T>(
  path: string,
  params: Params = {},
  init?: RequestInit,
): Promise<T> {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = (await res
      .json()
      .catch(() => ({ error: res.statusText }))) as { error?: string };
    throw new ApiError(res.status, body.error || res.statusText);
  }
  return res.json() as Promise<T>;
}

/* ------------------------------------------------------------------ */
/* Endpoints                                                           */
/* ------------------------------------------------------------------ */

export interface JudgmentSearchOpts {
  court?: string;
  year_range?: string;
  since?: string;
  judge?: string;
  limit?: number;
}

export const sgjudge = {
  searchJudgments: (
    q: string,
    opts: JudgmentSearchOpts = {},
    init?: RequestInit,
  ) =>
    get<SearchResponse<JudgmentHit>>(
      "/v1/judgments/search",
      { q, ...opts },
      init,
    ),

  getJudgment: (
    citation: string,
    opts: {
      include_body?: boolean;
      body_offset?: number;
      body_length?: number;
    } = {},
    init?: RequestInit,
  ) =>
    get<JudgmentDetail>(
      `/v1/judgments/${encodeURIComponent(citation)}`,
      opts as Params,
      init,
    ),

  searchStatutes: (
    q: string,
    opts: { kind?: string; limit?: number } = {},
    init?: RequestInit,
  ) =>
    get<SearchResponse<StatuteHit>>(
      "/v1/statutes/search",
      { q, ...opts },
      init,
    ),

  getStatute: (
    reference: string,
    opts: { kind?: string; include_body?: boolean } = {},
    init?: RequestInit,
  ) =>
    get<StatuteDetail>(
      `/v1/statutes/${encodeURIComponent(reference)}`,
      opts as Params,
      init,
    ),

  getStatuteSection: (actId: string, sectionNo: string, init?: RequestInit) =>
    get<StatuteSection>(
      `/v1/statutes/${encodeURIComponent(actId)}/sections/${encodeURIComponent(sectionNo)}`,
      {},
      init,
    ),

  searchSubsidiary: (
    q: string,
    opts: { parent_act_id?: string; limit?: number } = {},
    init?: RequestInit,
  ) =>
    get<SearchResponse>(
      "/v1/subsidiary-legislation/search",
      { q, ...opts },
      init,
    ),

  searchHansard: (
    q: string,
    opts: { speaker?: string; since?: string; limit?: number } = {},
    init?: RequestInit,
  ) =>
    get<SearchResponse<HansardHit>>("/v1/hansard/search", { q, ...opts }, init),

  searchBills: (
    q: string,
    opts: { session?: string; status?: string; limit?: number } = {},
    init?: RequestInit,
  ) => get<SearchResponse<BillHit>>("/v1/bills/search", { q, ...opts }, init),

  searchPracticeDirections: (
    q: string,
    opts: { court?: string; limit?: number } = {},
    init?: RequestInit,
  ) =>
    get<SearchResponse>("/v1/practice-directions/search", { q, ...opts }, init),

  getDocument: (
    kind: DocumentKind,
    id: string,
    opts: {
      include_body?: boolean;
      body_offset?: number;
      body_length?: number;
    } = {},
    init?: RequestInit,
  ) => {
    const resource = DOCUMENT_KIND_PATHS[kind];
    if (!resource) {
      return Promise.reject(
        new ApiError(404, `unknown document kind: ${kind}`),
      );
    }
    return get<DocumentDetail>(
      `/v1/${resource}/${encodeURIComponent(id)}`,
      opts as Params,
      init,
    );
  },

  stats: (init?: RequestInit) => get<StatsResponse>("/v1/stats", {}, init),
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Safely parse the API's `*_json` string fields. */
export function parseJsonField<T = unknown>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/**
 * Map a bm25 score to a 0..1 relevance fraction for a result set.
 * bm25 is negative; more negative = more relevant. We normalise within the
 * current page so the best hit fills the bar and the worst stays visible.
 */
export function relevanceFraction(score: number, scores: number[]): number {
  if (scores.length === 0) return 0;
  const best = Math.min(...scores); // most negative
  const worst = Math.max(...scores);
  if (best === worst) return 1;
  // best -> 1, worst -> ~0.15 (keep a minimum visible sliver)
  const t = (worst - score) / (worst - best);
  return 0.15 + 0.85 * t;
}

export function statuteSectionText(section: StatuteSection): string {
  const text = section.text?.trim() ? section.text : undefined;
  const bodyText = section.body_text?.trim() ? section.body_text : undefined;
  return text ?? bodyText ?? "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function statuteSectionDisplayText(section: StatuteSection): string {
  let text = statuteSectionText(section)
    .replace(/^\uFEFF/, "")
    .trim();
  const sectionNo = section.section_no.trim();
  if (!sectionNo) return text;

  const escapedNo = escapeRegExp(sectionNo);
  const numberLead = `${escapedNo}\\s*\\.?\\s*(?:[—–-]\\s*)?`;

  if (section.heading?.trim()) {
    const escapedHeading = escapeRegExp(section.heading.trim());
    text = text.replace(
      new RegExp(`^${escapedHeading}\\s+${numberLead}`, "i"),
      "",
    );
  }

  return text.replace(new RegExp(`^${numberLead}`, "i"), "").trimStart();
}

type SectionNoParts = {
  numeric: boolean;
  number: number;
  suffix: string;
  rest: string;
};

function sectionNoParts(sectionNo: string): SectionNoParts {
  const normalized = sectionNo.trim().toUpperCase();
  const match = normalized.match(/^(\d+)([A-Z]*)\b(.*)$/);
  if (!match) return { numeric: false, number: 0, suffix: "", rest: "" };
  return {
    numeric: true,
    number: Number(match[1]),
    suffix: match[2] ?? "",
    rest: match[3] ?? "",
  };
}

export function compareStatuteSections(
  a: StatuteSection,
  b: StatuteSection,
): number {
  const aParts = sectionNoParts(a.section_no);
  const bParts = sectionNoParts(b.section_no);
  if (!aParts.numeric && !bParts.numeric) return 0;
  if (!aParts.numeric) return 1;
  if (!bParts.numeric) return -1;
  return (
    aParts.number - bParts.number ||
    aParts.suffix.localeCompare(bParts.suffix, undefined, { numeric: true }) ||
    aParts.rest.localeCompare(bParts.rest, undefined, { numeric: true }) ||
    a.section_no.localeCompare(b.section_no, undefined, { numeric: true })
  );
}

export function sortStatuteSections(
  sections: StatuteSection[] = [],
): StatuteSection[] {
  return [...sections].sort(compareStatuteSections);
}
