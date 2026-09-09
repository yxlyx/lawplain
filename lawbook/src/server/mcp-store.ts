import {
  type McpFeedback,
  mcpFeedbackSchema,
  redactMcpText,
} from "./mcp-feedback";

export type McpAccessStatus = "pending" | "approved" | "suspended";

export interface McpAccess {
  userId: string;
  status: McpAccessStatus;
  canSearch: number;
  canRead: number;
  requestsPerMinute: number;
  requestedAt: number;
  updatedAt: number;
}

export interface McpIdentity {
  id: string;
  userId: string;
}
export interface McpActivity {
  id: string;
  userId: string;
  keyId: string;
  keyName: string;
  operation: string;
  outcome: string;
  durationMs: number;
  responseBytes: number;
  createdAt: number;
  hasResearch: number;
  rating: "helpful" | "not_helpful" | null;
}

export interface McpResearch {
  activityId: string;
  requestText: string;
  replyText: string;
  truncated: number;
  rating: "helpful" | "not_helpful" | null;
  comment: string | null;
  sharedAnswer: string | null;
  ratedAt: number | null;
}

export const MCP_RETENTION_MS = 30 * 24 * 60 * 60_000;

/** D1 is injected so authorization, atomic quotas and audit isolation are testable. */
export class McpStore {
  private readonly db: D1Database;
  constructor(db: D1Database) {
    this.db = db;
  }

  async access(userId: string): Promise<McpAccess | null> {
    return this.db
      .prepare("SELECT * FROM mcp_access WHERE userId = ?")
      .bind(userId)
      .first<McpAccess>();
  }

  async enabled(): Promise<boolean> {
    const row = await this.db
      .prepare("SELECT enabled FROM mcp_settings WHERE id = 'global'")
      .first<{ enabled: number }>();
    return row?.enabled === 1;
  }

  async requestAccess(userId: string): Promise<void> {
    const now = Date.now();
    // A suspended user cannot approve or requeue themselves by requesting again.
    await this.db
      .prepare(
        "INSERT INTO mcp_access (userId, requestedAt, updatedAt) VALUES (?, ?, ?) ON CONFLICT(userId) DO NOTHING",
      )
      .bind(userId, now, now)
      .run();
  }

  async policy(
    identity: McpIdentity,
  ): Promise<
    { allowed: true; access: McpAccess } | { allowed: false; reason: string }
  > {
    const key = await this.db
      .prepare(
        "SELECT mcpEnabled FROM api_keys WHERE id = ? AND userId = ? AND revokedAt IS NULL",
      )
      .bind(identity.id, identity.userId)
      .first<{ mcpEnabled: number }>();
    if (!key || key.mcpEnabled !== 1)
      return {
        allowed: false,
        reason: "Enable MCP for this key at /developers.",
      };
    if (!(await this.enabled()))
      return { allowed: false, reason: "Lawplain MCP is temporarily paused." };
    const access = await this.access(identity.userId);
    if (access?.status !== "approved")
      return {
        allowed: false,
        reason: "MCP access requires approval. Check /developers.",
      };
    return { allowed: true, access };
  }

  async consume(
    userId: string,
    limit: number,
    now = Date.now(),
  ): Promise<boolean> {
    const windowStart = Math.floor(now / 60_000) * 60_000;
    // One atomic statement across all Workers and keys for the same account.
    const row = await this.db
      .prepare(`INSERT INTO mcp_rate_windows (userId, windowStart, requests)
      VALUES (?, ?, 1) ON CONFLICT(userId, windowStart) DO UPDATE SET requests = requests + 1
      WHERE requests < ? RETURNING requests`)
      .bind(userId, windowStart, limit)
      .first<{ requests: number }>();
    return row !== null;
  }

  async record(
    identity: McpIdentity,
    operation: string,
    outcome: string,
    durationMs = 0,
    responseBytes = 0,
  ): Promise<string> {
    const now = Date.now();
    const id = crypto.randomUUID();
    await this.db.batch([
      this.db
        .prepare(`INSERT INTO mcp_activity
        (id, userId, keyId, operation, outcome, durationMs, responseBytes, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          id,
          identity.userId,
          identity.id,
          operation,
          outcome,
          Math.max(0, Math.round(durationMs)),
          responseBytes,
          now,
        ),
      this.db
        .prepare(
          "UPDATE api_keys SET lastUsedAt = ? WHERE id = ? AND userId = ?",
        )
        .bind(now, identity.id, identity.userId),
      this.db
        .prepare("DELETE FROM mcp_activity WHERE createdAt < ?")
        .bind(now - MCP_RETENTION_MS),
      this.db
        .prepare("DELETE FROM mcp_rate_windows WHERE windowStart < ?")
        .bind(now - 120_000),
      this.db
        .prepare("DELETE FROM mcp_admin_audit WHERE createdAt < ?")
        .bind(now - MCP_RETENTION_MS),
    ]);
    return id;
  }

  async finish(
    id: string,
    outcome: string,
    durationMs: number,
    responseBytes: number,
  ): Promise<void> {
    await this.db
      .prepare(
        "UPDATE mcp_activity SET outcome = ?, durationMs = ?, responseBytes = ? WHERE id = ?",
      )
      .bind(outcome, Math.max(0, Math.round(durationMs)), responseBytes, id)
      .run();
  }

  async capture(id: string, args: unknown, reply: unknown): Promise<void> {
    const request = redactMcpText(JSON.stringify(args ?? {}));
    const result = redactMcpText(JSON.stringify(reply ?? null));
    await this.db
      .prepare(`INSERT INTO mcp_research (activityId, requestText, replyText, truncated)
      VALUES (?, ?, ?, ?)`)
      .bind(
        id,
        request.slice(0, 8000),
        result.slice(0, 64000),
        Number(request.length > 8000 || result.length > 64000),
      )
      .run();
  }

  async research(id: string, userId?: string): Promise<McpResearch | null> {
    return this.db
      .prepare(`SELECT r.* FROM mcp_research r JOIN mcp_activity a ON a.id = r.activityId
      WHERE a.id = ? AND a.createdAt >= ? ${userId ? "AND a.userId = ?" : ""}`)
      .bind(id, Date.now() - MCP_RETENTION_MS, ...(userId ? [userId] : []))
      .first<McpResearch>();
  }

  async feedback(userId: string, input: McpFeedback): Promise<boolean> {
    const parsed = mcpFeedbackSchema.safeParse(input);
    if (!parsed.success) return false;
    const { activityId, rating, comment, sharedAnswer } = parsed.data;
    const row = await this.db
      .prepare(`UPDATE mcp_research SET rating = ?, comment = ?, sharedAnswer = ?, ratedAt = ?
      WHERE activityId IN (SELECT id FROM mcp_activity WHERE id = ? AND userId = ? AND createdAt >= ? AND outcome != 'started') RETURNING activityId`)
      .bind(
        rating,
        rating ? redactMcpText(comment ?? "") : null,
        rating ? redactMcpText(sharedAnswer ?? "") : null,
        rating ? Date.now() : null,
        activityId,
        userId,
        Date.now() - MCP_RETENTION_MS,
      )
      .first();
    return row !== null;
  }

  async activity(
    userId?: string,
    rating?: "helpful" | "not_helpful",
  ): Promise<McpActivity[]> {
    const { results } = await this.db
      .prepare(`SELECT a.id, a.userId, a.keyId, k.name AS keyName, a.operation, a.outcome, a.durationMs, a.responseBytes, a.createdAt,
      CASE WHEN r.activityId IS NULL THEN 0 ELSE 1 END AS hasResearch, r.rating
      FROM mcp_activity a JOIN api_keys k ON k.id = a.keyId AND k.userId = a.userId
      LEFT JOIN mcp_research r ON r.activityId = a.id
      WHERE a.createdAt >= ? ${userId ? "AND a.userId = ?" : ""} ${rating ? "AND r.rating = ?" : ""} ORDER BY a.createdAt DESC LIMIT 100`)
      .bind(
        Date.now() - MCP_RETENTION_MS,
        ...(userId ? [userId] : []),
        ...(rating ? [rating] : []),
      )
      .all<McpActivity>();
    return results ?? [];
  }

  async summary(userId?: string) {
    return this.db
      .prepare(`SELECT COUNT(*) AS requests,
      COALESCE(SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END), 0) AS successful,
      COALESCE(SUM(responseBytes), 0) AS responseBytes,
      COALESCE(ROUND(AVG(durationMs)), 0) AS averageMs
      FROM mcp_activity WHERE createdAt >= ? ${userId ? "AND userId = ?" : ""}`)
      .bind(Date.now() - 24 * 60 * 60_000, ...(userId ? [userId] : []))
      .first();
  }

  async users(offset = 0) {
    const { results } = await this.db
      .prepare(`SELECT a.*, u.name, u.email,
      (SELECT COUNT(*) FROM api_keys k WHERE k.userId = a.userId AND k.mcpEnabled = 1 AND k.revokedAt IS NULL) AS enabledKeys
      FROM mcp_access a JOIN user u ON u.id = a.userId
      ORDER BY CASE a.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, a.requestedAt DESC, a.userId
      LIMIT 51 OFFSET ?`)
      .bind(offset)
      .all();
    return {
      users: (results ?? []).slice(0, 50),
      hasMore: (results?.length ?? 0) > 50,
    };
  }

  async setAccess(
    actorId: string,
    userId: string,
    settings: {
      status: McpAccessStatus;
      canSearch: boolean;
      canRead: boolean;
      requestsPerMinute: number;
    },
  ): Promise<boolean> {
    if (!(await this.access(userId))) return false;
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE mcp_access SET status = ?, canSearch = ?, canRead = ?, requestsPerMinute = ?, updatedAt = ?, updatedBy = ? WHERE userId = ?`,
        )
        .bind(
          settings.status,
          Number(settings.canSearch),
          Number(settings.canRead),
          settings.requestsPerMinute,
          Date.now(),
          actorId,
          userId,
        ),
      this.db
        .prepare(
          "INSERT INTO mcp_admin_audit (id, actorId, targetUserId, action, settingsJson, createdAt) VALUES (?, ?, ?, 'access_updated', ?, ?)",
        )
        .bind(
          crypto.randomUUID(),
          actorId,
          userId,
          JSON.stringify(settings),
          Date.now(),
        ),
    ]);
    return true;
  }

  async setEnabled(actorId: string, enabled: boolean): Promise<void> {
    await this.db.batch([
      this.db
        .prepare("UPDATE mcp_settings SET enabled = ? WHERE id = 'global'")
        .bind(Number(enabled)),
      this.db
        .prepare(
          "INSERT INTO mcp_admin_audit (id, actorId, action, settingsJson, createdAt) VALUES (?, ?, 'service_updated', ?, ?)",
        )
        .bind(
          crypto.randomUUID(),
          actorId,
          JSON.stringify({ enabled }),
          Date.now(),
        ),
    ]);
  }

  async audit() {
    const { results } = await this.db
      .prepare(`SELECT a.id, u.email AS actor, a.targetUserId, a.action, a.settingsJson, a.createdAt
      FROM mcp_admin_audit a JOIN user u ON u.id = a.actorId WHERE a.createdAt >= ? ORDER BY a.createdAt DESC LIMIT 50`)
      .bind(Date.now() - MCP_RETENTION_MS)
      .all();
    return results ?? [];
  }

  async purge(now = Date.now()): Promise<void> {
    await this.db.batch([
      this.db
        .prepare("DELETE FROM mcp_activity WHERE createdAt < ?")
        .bind(now - MCP_RETENTION_MS),
      this.db
        .prepare("DELETE FROM mcp_admin_audit WHERE createdAt < ?")
        .bind(now - MCP_RETENTION_MS),
      this.db
        .prepare("DELETE FROM mcp_rate_windows WHERE windowStart < ?")
        .bind(now - 120_000),
    ]);
  }
}
