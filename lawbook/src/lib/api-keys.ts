import { getCloudflareContext } from "@opennextjs/cloudflare";

interface ApiKeysEnv extends CloudflareEnv {
  AUTH_DB?: D1Database;
}

export interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

/** Guard against a single account hoarding keys. */
const MAX_ACTIVE_KEYS = 20;

async function getDb(): Promise<D1Database> {
  const { env } = await getCloudflareContext({ async: true });
  const db = (env as ApiKeysEnv).AUTH_DB;
  if (!db) {
    throw new Error(
      "Missing Cloudflare D1 binding AUTH_DB. Apply migrations before using API keys.",
    );
  }
  return db;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** SHA-256 hex via Web Crypto (available in the Workers runtime). */
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return toHex(new Uint8Array(buf));
}

/** A high-entropy, prefixed key: `lp_live_<48 hex>`. Shown to the user once. */
function generateRawKey(): string {
  return `lp_live_${toHex(crypto.getRandomValues(new Uint8Array(24)))}`;
}

export async function listApiKeys(userId: string): Promise<ApiKeySummary[]> {
  const db = await getDb();
  const { results } = await db
    .prepare(
      `SELECT id, name, prefix, createdAt, lastUsedAt, revokedAt
       FROM api_keys
       WHERE userId = ?
       ORDER BY createdAt DESC`,
    )
    .bind(userId)
    .all<ApiKeySummary>();
  return (results ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    createdAt: Number(r.createdAt),
    lastUsedAt: r.lastUsedAt == null ? null : Number(r.lastUsedAt),
    revokedAt: r.revokedAt == null ? null : Number(r.revokedAt),
  }));
}

export async function createApiKey(
  userId: string,
  name: string,
): Promise<{ key: string; summary: ApiKeySummary } | { error: string }> {
  const db = await getDb();
  const active = await db
    .prepare(
      "SELECT count(*) AS n FROM api_keys WHERE userId = ? AND revokedAt IS NULL",
    )
    .bind(userId)
    .first<{ n: number }>();
  if ((active?.n ?? 0) >= MAX_ACTIVE_KEYS) {
    return {
      error: `Key limit reached (${MAX_ACTIVE_KEYS}). Revoke one first.`,
    };
  }

  const key = generateRawKey();
  const keyHash = await sha256Hex(key);
  const prefix = key.slice(0, 12); // lp_live_xxxx
  const id = crypto.randomUUID();
  const now = Date.now();
  const cleanName = (name || "API key").trim().slice(0, 80) || "API key";

  await db
    .prepare(
      `INSERT INTO api_keys (id, userId, name, keyHash, prefix, createdAt, lastUsedAt, revokedAt)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`,
    )
    .bind(id, userId, cleanName, keyHash, prefix, now)
    .run();

  return {
    key,
    summary: {
      id,
      name: cleanName,
      prefix,
      createdAt: now,
      lastUsedAt: null,
      revokedAt: null,
    },
  };
}

export async function revokeApiKey(userId: string, id: string): Promise<void> {
  const db = await getDb();
  await db
    .prepare(
      "UPDATE api_keys SET revokedAt = ? WHERE userId = ? AND id = ? AND revokedAt IS NULL",
    )
    .bind(Date.now(), userId, id)
    .run();
}

/** Validate a raw Bearer key. Returns the owning identity or null. */
export async function validateApiKey(
  rawKey: string,
): Promise<{ id: string; userId: string } | null> {
  if (!rawKey || !rawKey.startsWith("lp_")) return null;
  const db = await getDb();
  const keyHash = await sha256Hex(rawKey);
  // Exact match on the unique, indexed hash — no per-key scan, no timing leak.
  const row = await db
    .prepare(
      "SELECT id, userId FROM api_keys WHERE keyHash = ? AND revokedAt IS NULL",
    )
    .bind(keyHash)
    .first<{ id: string; userId: string }>();
  return row ?? null;
}

export async function touchApiKey(id: string): Promise<void> {
  const db = await getDb();
  await db
    .prepare("UPDATE api_keys SET lastUsedAt = ? WHERE id = ?")
    .bind(Date.now(), id)
    .run();
}
