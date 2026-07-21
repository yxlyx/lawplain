import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  hasApiCredentialQuery,
  proxyResponseBody,
} from "../src/lib/api-gateway.ts";
import {
  API_KEY_PREFIX,
  API_KEY_RANDOM_BYTES,
  generateRawApiKey,
  hashApiKey,
  isApiKeyFormat,
  normalizeApiKeyName,
  readBearerApiKey,
} from "../src/lib/api-key-auth.ts";
import { ApiKeyStore, MAX_ACTIVE_API_KEYS } from "../src/lib/api-key-store.ts";

class FakeD1Database {
  rows = [];
  prepareCalls = 0;

  prepare(sql) {
    this.prepareCalls += 1;
    return new FakeD1Statement(this, sql);
  }
}

class FakeD1Statement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  async all() {
    const [userId] = this.args;
    const results = this.db.rows
      .filter((row) => row.userId === userId)
      .sort((left, right) => right.createdAt - left.createdAt)
      .map(({ keyHash: _keyHash, userId: _userId, ...summary }) => summary);
    return { results };
  }

  async first() {
    const [keyHash] = this.args;
    const row = this.db.rows.find(
      (candidate) =>
        candidate.keyHash === keyHash && candidate.revokedAt === null,
    );
    return row ? { id: row.id, userId: row.userId } : null;
  }

  async run() {
    if (this.sql.includes("INSERT INTO api_keys")) {
      const [
        id,
        userId,
        name,
        keyHash,
        prefix,
        createdAt,
        countedUserId,
        maximum,
      ] = this.args;
      assert.equal(countedUserId, userId);
      const active = this.db.rows.filter(
        (row) => row.userId === userId && row.revokedAt === null,
      ).length;
      if (active >= maximum) return { meta: { changes: 0 } };
      this.db.rows.push({
        id,
        userId,
        name,
        keyHash,
        prefix,
        createdAt,
        lastUsedAt: null,
        revokedAt: null,
      });
      return { meta: { changes: 1 } };
    }

    if (this.sql.includes("SET revokedAt")) {
      const [revokedAt, userId, id] = this.args;
      const row = this.db.rows.find(
        (candidate) =>
          candidate.id === id &&
          candidate.userId === userId &&
          candidate.revokedAt === null,
      );
      if (!row) return { meta: { changes: 0 } };
      row.revokedAt = revokedAt;
      return { meta: { changes: 1 } };
    }

    if (this.sql.includes("SET lastUsedAt")) {
      const [lastUsedAt, id] = this.args;
      const row = this.db.rows.find(
        (candidate) => candidate.id === id && candidate.revokedAt === null,
      );
      if (!row) return { meta: { changes: 0 } };
      row.lastUsedAt = Math.max(row.lastUsedAt ?? 0, lastUsedAt);
      return { meta: { changes: 1 } };
    }

    throw new Error(`Unexpected SQL: ${this.sql}`);
  }
}

test("API keys use the expected prefix and 192 bits of randomness", () => {
  const first = generateRawApiKey();
  const second = generateRawApiKey();

  assert.equal(first.length, API_KEY_PREFIX.length + API_KEY_RANDOM_BYTES * 2);
  assert.match(first, /^lp_live_[0-9a-f]{48}$/);
  assert.equal(isApiKeyFormat(first), true);
  assert.notEqual(first, second);
  assert.equal(isApiKeyFormat("lp_live_short"), false);
  assert.equal(isApiKeyFormat(`lp_test_${"a".repeat(48)}`), false);
});

test("Bearer parsing is strict and never falls back to URL credentials", () => {
  const key = `lp_live_${"a".repeat(48)}`;
  assert.equal(readBearerApiKey(`Bearer ${key}`), key);
  assert.equal(readBearerApiKey(`bearer\t${key}`), key);
  assert.equal(readBearerApiKey(`Basic ${key}`), null);
  assert.equal(readBearerApiKey(`Bearer ${key},other`), null);
  assert.equal(readBearerApiKey(`Bearer ${key} trailing`), null);
  assert.equal(readBearerApiKey(null), null);
});

test("credential-like query parameters are rejected before proxying", () => {
  const key = `lp_live_${"a".repeat(48)}`;
  const rejected = [
    `api_key=${key}`,
    `API-KEY=${key}`,
    `authorization=${encodeURIComponent(`Bearer ${key}`)}`,
    `other=${encodeURIComponent(`Bearer ${key}`)}`,
    `access_token=not-even-a-key`,
  ];
  for (const query of rejected) {
    assert.equal(
      hasApiCredentialQuery(new URLSearchParams(query)),
      true,
      query,
    );
  }
  assert.equal(
    hasApiCredentialQuery(
      new URLSearchParams("q=negligence&court=SGCA&limit=5"),
    ),
    false,
  );
});

test("proxy response bodies comply with null-body HTTP statuses", () => {
  assert.equal(proxyResponseBody(200, "{}"), "{}");
  assert.equal(proxyResponseBody(204, ""), null);
  assert.equal(proxyResponseBody(205, ""), null);
  assert.equal(proxyResponseBody(304, ""), null);
});

test("key names are bounded and blank names get a safe default", () => {
  assert.equal(normalizeApiKeyName("  deployment bot  "), "deployment bot");
  assert.equal(normalizeApiKeyName("   "), "API key");
  assert.equal(normalizeApiKeyName("x".repeat(100)).length, 80);
});

test("creation stores only a hash and listing never returns credential material", async () => {
  const db = new FakeD1Database();
  const store = new ApiKeyStore(db);
  const created = await store.create("user-a", "  research agent  ");

  assert.equal("error" in created, false);
  assert.match(created.key, /^lp_live_[0-9a-f]{48}$/);
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].keyHash, await hashApiKey(created.key));
  assert.notEqual(db.rows[0].keyHash, created.key);
  assert.equal(JSON.stringify(db.rows).includes(created.key), false);

  const listed = await store.list("user-a");
  assert.deepEqual(listed, [created.summary]);
  assert.equal("keyHash" in listed[0], false);
  assert.equal("key" in listed[0], false);
});

test("validation rejects malformed, unknown, and revoked keys", async () => {
  const db = new FakeD1Database();
  const store = new ApiKeyStore(db);
  const created = await store.create("user-a", "agent");
  assert.equal("error" in created, false);

  const callsBeforeMalformedKey = db.prepareCalls;
  assert.equal(await store.validate("lp_live_short"), null);
  assert.equal(db.prepareCalls, callsBeforeMalformedKey);
  assert.equal(await store.validate(`lp_live_${"0".repeat(48)}`), null);
  assert.deepEqual(await store.validate(created.key), {
    id: created.summary.id,
    userId: "user-a",
  });

  assert.equal(await store.revoke("user-b", created.summary.id), false);
  assert.notEqual(await store.validate(created.key), null);
  assert.equal(await store.revoke("user-a", created.summary.id), true);
  assert.equal(await store.validate(created.key), null);
  assert.equal(await store.revoke("user-a", created.summary.id), false);
});

test("last-used metadata cannot move backwards under concurrent updates", async () => {
  const db = new FakeD1Database();
  const store = new ApiKeyStore(db);
  const created = await store.create("user-a", "agent");
  assert.equal("error" in created, false);

  await store.touch(created.summary.id, 200);
  await store.touch(created.summary.id, 100);
  assert.equal(db.rows[0].lastUsedAt, 200);
});

test("the per-user active-key cap is enforced atomically and revoked slots reopen", async () => {
  const db = new FakeD1Database();
  const store = new ApiKeyStore(db);
  const created = [];
  for (let index = 0; index < MAX_ACTIVE_API_KEYS; index += 1) {
    created.push(await store.create("user-a", `key ${index}`));
  }
  assert.equal(
    created.every((result) => !("error" in result)),
    true,
  );

  const limited = await store.create("user-a", "one too many");
  assert.deepEqual(limited, {
    error: `Key limit reached (${MAX_ACTIVE_API_KEYS}). Revoke one first.`,
  });

  const first = created[0];
  assert.equal("error" in first, false);
  assert.equal(await store.revoke("user-a", first.summary.id), true);
  assert.equal("error" in (await store.create("user-a", "replacement")), false);
  assert.equal("error" in (await store.create("user-b", "independent")), false);
});

test("the API gateway requires Authorization and disables shared caching", () => {
  const route = readFileSync(
    new URL("../src/app/api/v1/[...path]/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    route,
    /readBearerApiKey\(req\.headers\.get\("authorization"\)\)/,
  );
  assert.doesNotMatch(route, /searchParams\.get\("api_key"\)/);
  assert.match(route, /hasApiCredentialQuery\(url\.searchParams\)/);
  assert.match(route, /consumeRateLimit\(`api-ip:/);
  assert.match(route, /consumeRateLimit\(`api-user:/);
  assert.match(route, /"cache-control": "private, no-store"/);
  assert.match(route, /vary: "Authorization"/);
  assert.match(route, /validateApiKey\(rawKey\)/);
});
