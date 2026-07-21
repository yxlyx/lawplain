import {
  API_KEY_VISIBLE_PREFIX_LENGTH,
  generateRawApiKey,
  hashApiKey,
  isApiKeyFormat,
  normalizeApiKeyName,
} from "./api-key-auth.ts";

export interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export type CreateApiKeyResult =
  | { key: string; summary: ApiKeySummary }
  | { error: string };

/** Guard against a single account hoarding keys. */
export const MAX_ACTIVE_API_KEYS = 20;

/** D1-backed store, kept independent from the runtime binding for testability. */
export class ApiKeyStore {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async list(userId: string): Promise<ApiKeySummary[]> {
    const { results } = await this.db
      .prepare(
        `SELECT id, name, prefix, createdAt, lastUsedAt, revokedAt
         FROM api_keys
         WHERE userId = ?
         ORDER BY createdAt DESC`,
      )
      .bind(userId)
      .all<ApiKeySummary>();
    return (results ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      createdAt: Number(row.createdAt),
      lastUsedAt: row.lastUsedAt == null ? null : Number(row.lastUsedAt),
      revokedAt: row.revokedAt == null ? null : Number(row.revokedAt),
    }));
  }

  async create(userId: string, name: string): Promise<CreateApiKeyResult> {
    const key = generateRawApiKey();
    const keyHash = await hashApiKey(key);
    const prefix = key.slice(0, API_KEY_VISIBLE_PREFIX_LENGTH);
    const id = crypto.randomUUID();
    const now = Date.now();
    const cleanName = normalizeApiKeyName(name);

    // A conditional insert keeps the active-key cap atomic under concurrent
    // creation requests; a separate count followed by an insert can race.
    const result = await this.db
      .prepare(
        `INSERT INTO api_keys
           (id, userId, name, keyHash, prefix, createdAt, lastUsedAt, revokedAt)
         SELECT ?, ?, ?, ?, ?, ?, NULL, NULL
         WHERE (
           SELECT COUNT(*) FROM api_keys
           WHERE userId = ? AND revokedAt IS NULL
         ) < ?`,
      )
      .bind(
        id,
        userId,
        cleanName,
        keyHash,
        prefix,
        now,
        userId,
        MAX_ACTIVE_API_KEYS,
      )
      .run();

    if (Number(result.meta.changes ?? 0) !== 1) {
      return {
        error: `Key limit reached (${MAX_ACTIVE_API_KEYS}). Revoke one first.`,
      };
    }

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

  async revoke(userId: string, id: string): Promise<boolean> {
    const result = await this.db
      .prepare(
        "UPDATE api_keys SET revokedAt = ? WHERE userId = ? AND id = ? AND revokedAt IS NULL",
      )
      .bind(Date.now(), userId, id)
      .run();
    return Number(result.meta.changes ?? 0) === 1;
  }

  /** Validate a raw Bearer key. Returns the owning identity or null. */
  async validate(
    rawKey: string,
  ): Promise<{ id: string; userId: string } | null> {
    if (!isApiKeyFormat(rawKey)) return null;
    const keyHash = await hashApiKey(rawKey);
    const row = await this.db
      .prepare(
        "SELECT id, userId FROM api_keys WHERE keyHash = ? AND revokedAt IS NULL",
      )
      .bind(keyHash)
      .first<{ id: string; userId: string }>();
    return row ?? null;
  }

  async touch(id: string, usedAt = Date.now()): Promise<void> {
    await this.db
      .prepare(
        `UPDATE api_keys
         SET lastUsedAt = MAX(COALESCE(lastUsedAt, 0), ?)
         WHERE id = ? AND revokedAt IS NULL`,
      )
      .bind(usedAt, id)
      .run();
  }
}
