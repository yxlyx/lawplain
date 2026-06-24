// server-only: relies on Cloudflare D1 (AUTH_DB) and must never be imported into client code.
import { getCloudflareContext } from "@opennextjs/cloudflare";

interface EngagementEnv extends CloudflareEnv {
  AUTH_DB?: D1Database;
}

export const MIN_SAMPLE = 30;
export const TOP_N = 5;
export const RATE_LIMIT_PER_MIN = 60;

export type DocType = "judgment" | "statute";

export interface EngagementEvent {
  docType: DocType;
  docId: string;
  term: string;
  sectionId: string;
}

export interface SuggestionResult {
  total: number;
  sections: { sectionId: string; count: number }[];
}

async function getEngagementDb(): Promise<D1Database> {
  const { env } = await getCloudflareContext({ async: true });
  const db = (env as EngagementEnv).AUTH_DB;

  if (!db) {
    throw new Error(
      "Missing Cloudflare D1 binding AUTH_DB. Create the D1 database and configure wrangler.jsonc before using engagement tracking.",
    );
  }

  return db;
}

// Upsert one engagement count. Returns void. Best-effort; caller handles errors.
export async function recordEngagement(ev: EngagementEvent): Promise<void> {
  const db = await getEngagementDb();

  await db
    .prepare(
      `INSERT INTO section_engagement (doc_type, doc_id, term, section_id, count)
       VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(doc_type, doc_id, term, section_id)
       DO UPDATE SET count = count + 1`,
    )
    .bind(ev.docType, ev.docId, ev.term, ev.sectionId)
    .run();
}

// Read aggregate suggestions. Returns total across all sections for {docType,docId,term};
// sections is top-N by count desc, but ONLY when total >= MIN_SAMPLE, else empty array (total still returned).
export async function getSuggestions(args: {
  docType: DocType;
  docId: string;
  term: string;
}): Promise<SuggestionResult> {
  const db = await getEngagementDb();

  const totalRow = await db
    .prepare(
      `SELECT SUM(count) AS total
       FROM section_engagement
       WHERE doc_type = ? AND doc_id = ? AND term = ?`,
    )
    .bind(args.docType, args.docId, args.term)
    .first<{ total: number | null }>();

  const total = totalRow?.total ?? 0;

  if (total < MIN_SAMPLE) {
    return { total, sections: [] };
  }

  const rows = await db
    .prepare(
      `SELECT section_id, count
       FROM section_engagement
       WHERE doc_type = ? AND doc_id = ? AND term = ?
       ORDER BY count DESC
       LIMIT ?`,
    )
    .bind(args.docType, args.docId, args.term, TOP_N)
    .all<{ section_id: string; count: number }>();

  const sections = (rows.results ?? []).map((row) => ({
    sectionId: row.section_id,
    count: row.count,
  }));

  return { total, sections };
}

async function rateLimitBucket(ip: string, minute: number): Promise<string> {
  const input = new TextEncoder().encode(`${minute}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `engagement:${minute}:${hash.slice(0, 32)}`;
}

// Token-bucket-ish per-IP limiter using a short-lived, hashed bucket key;
// returns true if allowed. Raw IP addresses are never persisted.
export async function checkRateLimit(ip: string): Promise<boolean> {
  const db = await getEngagementDb();

  const now = Date.now();
  const minute = Math.floor(now / 60000);
  const bucket = await rateLimitBucket(ip, minute);
  const expiresAt = (minute + 2) * 60000;

  // Opportunistically clean up expired buckets.
  await db
    .prepare(`DELETE FROM engagement_rate WHERE expiresAt < ?`)
    .bind(now)
    .run();

  const row = await db
    .prepare(
      `INSERT INTO engagement_rate (bucket, count, expiresAt)
       VALUES (?, 1, ?)
       ON CONFLICT(bucket)
       DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .bind(bucket, expiresAt)
    .first<{ count: number }>();

  const count = row?.count ?? 0;

  return count <= RATE_LIMIT_PER_MIN;
}
