import {
  isSuggestionDocType,
  normalizeSuggestionTerm,
  type SuggestionDocType,
} from "@/lib/suggestions";

export const ENGAGEMENT_EVENT_KIND = "section_engage";

const MAX_DOC_ID = 160;
const MAX_TERM = 80;
const MAX_SECTION_ID = 120;
const MAX_TERMS_PER_DOC = 200;
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_EVENTS = 120;

export interface SectionEngagementEvent {
  kind: typeof ENGAGEMENT_EVENT_KIND;
  docType: SuggestionDocType;
  docId: string;
  term: string;
  sectionId: string;
}

export function parseSectionEngagementEvent(
  input: unknown,
): SectionEngagementEvent | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  const kind = value.kind;
  const docType = value.docType;
  const docId = typeof value.docId === "string" ? value.docId.trim() : "";
  const term = normalizeSuggestionTerm(
    typeof value.term === "string" ? value.term : "",
  );
  const sectionId =
    typeof value.sectionId === "string" ? value.sectionId.trim() : "";

  if (kind !== ENGAGEMENT_EVENT_KIND) return null;
  if (typeof docType !== "string" || !isSuggestionDocType(docType)) return null;
  if (!docId || !term || !sectionId) return null;
  if (
    docId.length > MAX_DOC_ID ||
    term.length > MAX_TERM ||
    sectionId.length > MAX_SECTION_ID
  ) {
    return null;
  }

  return { kind, docType, docId, term, sectionId };
}

function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function requestBucket(
  req: Request,
  windowSeconds: number,
): Promise<string> {
  const ua = req.headers.get("user-agent") ?? "";
  const ip = clientIp(req);
  const window = Math.floor(Date.now() / 1000 / windowSeconds);
  return (await sha256Hex(`section-engagement:${window}:${ip}:${ua}`)).slice(
    0,
    32,
  );
}

async function sampleBucket(req: Request): Promise<string> {
  const ua = req.headers.get("user-agent") ?? "";
  const ip = clientIp(req);
  const day = Math.floor(Date.now() / 86_400_000);
  return (await sha256Hex(`section-sample:${day}:${ip}:${ua}`)).slice(0, 32);
}

async function isRateLimited(db: D1Database, req: Request): Promise<boolean> {
  const bucket = await requestBucket(req, RATE_LIMIT_WINDOW_SECONDS);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + RATE_LIMIT_WINDOW_SECONDS;

  await db
    .prepare(
      `INSERT INTO engagement_rate (bucket, count, expires_at)
       VALUES (?, 1, ?)
       ON CONFLICT(bucket) DO UPDATE SET
         count = CASE
           WHEN engagement_rate.expires_at < excluded.expires_at - ? THEN 1
           ELSE engagement_rate.count + 1
         END,
         expires_at = excluded.expires_at`,
    )
    .bind(bucket, expiresAt, RATE_LIMIT_WINDOW_SECONDS)
    .run();

  const row = await db
    .prepare(`SELECT count FROM engagement_rate WHERE bucket = ?`)
    .bind(bucket)
    .first<{ count: number }>();

  return Number(row?.count ?? 0) > RATE_LIMIT_MAX_EVENTS;
}

async function hasTooManyTerms(
  db: D1Database,
  event: SectionEngagementEvent,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT COUNT(DISTINCT term) AS count
       FROM section_engagement
       WHERE doc_type = ? AND doc_id = ?`,
    )
    .bind(event.docType, event.docId)
    .first<{ count: number }>();

  const existing = Number(row?.count ?? 0);
  if (existing < MAX_TERMS_PER_DOC) return false;

  const present = await db
    .prepare(
      `SELECT 1 AS ok FROM section_engagement
       WHERE doc_type = ? AND doc_id = ? AND term = ?
       LIMIT 1`,
    )
    .bind(event.docType, event.docId, event.term)
    .first<{ ok: number }>();

  return !present;
}

export async function recordSectionEngagement({
  db,
  req,
  event,
}: {
  db: D1Database;
  req: Request;
  event: SectionEngagementEvent;
}): Promise<void> {
  if (await isRateLimited(db, req)) return;
  if (await hasTooManyTerms(db, event)) return;

  const bucket = await sampleBucket(req);
  const now = Math.floor(Date.now() / 1000);

  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO section_engagement_sample
         (doc_type, doc_id, term, sample_bucket, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(event.docType, event.docId, event.term, bucket, now),
    db
      .prepare(
        `INSERT INTO section_engagement
         (doc_type, doc_id, term, section_id, count, updated_at)
         VALUES (?, ?, ?, ?, 1, ?)
         ON CONFLICT(doc_type, doc_id, term, section_id) DO UPDATE SET
           count = count + 1,
           updated_at = excluded.updated_at`,
      )
      .bind(event.docType, event.docId, event.term, event.sectionId, now),
  ]);
}
