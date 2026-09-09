import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { extname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (
        error.code === "ERR_MODULE_NOT_FOUND" &&
        specifier.startsWith(".") &&
        !extname(specifier)
      )
        return next(specifier + ".ts", context);
      throw error;
    }
  },
});
const { McpStore, MCP_RETENTION_MS } = await import(
  "../src/server/mcp-store.ts"
);
const { handleLawplainMcp } = await import("../src/server/mcp-handler.ts");
const key = "lp_live_" + "a".repeat(48),
  otherKey = "lp_live_" + "b".repeat(48);

function fixture(t) {
  const sql = new DatabaseSync(":memory:");
  t.after(() => sql.close());
  sql.exec(
    "PRAGMA foreign_keys=ON; CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT, email TEXT);",
  );
  sql.exec(readFileSync("migrations/0010_api_keys.sql", "utf8"));
  sql.exec(readFileSync("migrations/0024_mcp_access.sql", "utf8"));
  for (const id of ["owner", "other", "admin"])
    sql
      .prepare("INSERT INTO user VALUES (?,?,?)")
      .run(id, id, id + "@example.test");
  for (const id of ["owner", "other"])
    sql
      .prepare(
        "INSERT INTO api_keys (id,userId,name,keyHash,prefix,createdAt) VALUES (?,?,?,?,?,?)",
      )
      .run("key-" + id, id, "test key", id, "lp_live_test", Date.now());
  const db = {
    prepare(query) {
      let params = [];
      return {
        bind(...values) {
          params = values;
          return this;
        },
        async first(column) {
          const row = sql.prepare(query).get(...params);
          return row ? (column ? row[column] : { ...row }) : null;
        },
        async all() {
          return {
            results: sql
              .prepare(query)
              .all(...params)
              .map((row) => ({ ...row })),
          };
        },
        async run() {
          const info = sql.prepare(query).run(...params);
          return { success: true, meta: { changes: Number(info.changes) } };
        },
      };
    },
    async batch(statements) {
      sql.exec("BEGIN");
      try {
        const out = [];
        for (const statement of statements) out.push(await statement.run());
        sql.exec("COMMIT");
        return out;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const store = new McpStore(db);
  let upstream = 0;
  const urls = [];
  const deps = {
    store,
    async authenticate(raw) {
      const user = raw === key ? "owner" : raw === otherKey ? "other" : null;
      if (!user) return null;
      return (
        sql
          .prepare(
            "SELECT id,userId FROM api_keys WHERE userId=? AND revokedAt IS NULL",
          )
          .get(user) ?? null
      );
    },
    async fetcher(url) {
      upstream++;
      urls.push(url);
      return Response.json({
        results: [{ citation: "[2026] SGCA 1", title: "Source title" }],
      });
    },
  };
  async function approve(user = "owner", settings = {}) {
    await store.requestAccess(user);
    await store.setAccess("admin", user, {
      status: "approved",
      canSearch: true,
      canRead: true,
      requestsPerMinute: 600,
      ...settings,
    });
    sql.prepare("UPDATE api_keys SET mcpEnabled=1 WHERE userId=?").run(user);
  }
  async function request(
    body,
    { token = key, headers = {}, method = "POST" } = {},
  ) {
    return handleLawplainMcp(
      new Request("https://lawplain.test/mcp", {
        method,
        headers: {
          authorization: "Bearer " + token,
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          ...headers,
        },
        ...(method === "POST"
          ? { body: typeof body === "string" ? body : JSON.stringify(body) }
          : {}),
      }),
      deps,
    );
  }
  return {
    sql,
    store,
    deps,
    approve,
    request,
    urls,
    get upstream() {
      return upstream;
    },
  };
}
const call = (name = "search_judgments", args = { query: "negligence" }) => ({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name, arguments: args },
});
async function message(response) {
  const text = await response.text();
  if (response.headers.get("content-type")?.includes("text/event-stream"))
    return text
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)))
      .find((item) => item.id === 1);
  return JSON.parse(text);
}

test("MCP starts denied and requires both account approval and per-key opt-in", async (t) => {
  const f = fixture(t);
  assert.equal((await f.request(call())).status, 403);
  await f.store.requestAccess("owner");
  assert.equal((await f.request(call())).status, 403);
  await f.store.setAccess("admin", "owner", {
    status: "approved",
    canSearch: true,
    canRead: true,
    requestsPerMinute: 60,
  });
  assert.equal((await f.request(call())).status, 403);
  f.sql.prepare("UPDATE api_keys SET mcpEnabled=1 WHERE userId=?").run("owner");
  assert.ok((await message(await f.request(call()))).result.content.length);
  assert.equal(f.upstream, 1);
});

test("suspension, key disable, revocation and global pause gate every subsequent request", async (t) => {
  const f = fixture(t);
  await f.approve();
  assert.equal((await f.request(call())).status, 200);
  await f.store.setEnabled("admin", false);
  assert.equal((await f.request(call())).status, 403);
  await f.store.setEnabled("admin", true);
  await f.store.setAccess("admin", "owner", {
    status: "suspended",
    canSearch: true,
    canRead: true,
    requestsPerMinute: 60,
  });
  await f.store.requestAccess("owner");
  assert.equal((await f.store.access("owner")).status, "suspended");
  assert.equal((await f.request(call())).status, 403);
  await f.approve();
  f.sql.prepare("UPDATE api_keys SET mcpEnabled=0 WHERE userId=?").run("owner");
  assert.equal((await f.request(call())).status, 403);
  f.sql
    .prepare("UPDATE api_keys SET mcpEnabled=1, revokedAt=1 WHERE userId=?")
    .run("owner");
  assert.equal((await f.request(call())).status, 401);
  assert.equal(f.upstream, 1);
});

test("an account cannot use another account key identity or see its usage", async (t) => {
  const f = fixture(t);
  await f.approve();
  await f.approve("other");
  assert.equal(
    (await f.store.policy({ id: "key-owner", userId: "other" })).allowed,
    false,
  );
  await f.request(call());
  await f.request(call(), { token: otherKey });
  const own = await f.store.activity("owner"),
    other = await f.store.activity("other");
  assert.equal(own.length, 1);
  assert.equal(other.length, 1);
  assert.ok(own.every((row) => row.userId === "owner"));
  assert.ok(other.every((row) => row.userId === "other"));
  assert.equal((await f.store.summary("owner")).requests, 1);
});

test("real SQLite quota permits exactly 10 of 50 simultaneous attempts", async (t) => {
  const f = fixture(t);
  await f.approve("owner", { requestsPerMinute: 10 });
  // Exercise the shared atomic counter directly; no test scheduling assumptions.
  const attempts = await Promise.all(
    Array.from({ length: 50 }, () =>
      f.store.consume("owner", 10, 1800000000000),
    ),
  );
  assert.equal(attempts.filter(Boolean).length, 10);
  assert.equal(await f.store.consume("owner", 10, 1800000060000), true);
  assert.equal(await f.store.consume("other", 10, 1800000000000), true);
});

test("HTTP quota blocks upstream requests and returns Retry-After", async (t) => {
  const f = fixture(t);
  await f.approve("owner", { requestsPerMinute: 1 });
  await f.request(call());
  const blocked = await f.request(call());
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  assert.equal(f.upstream, 1);
});

test("disabled tool groups cannot be listed or called directly", async (t) => {
  const f = fixture(t);
  await f.approve("owner", { canRead: false });
  const listed = await message(
    await f.request({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  );
  assert.equal(listed.result.tools.length, 4);
  assert.ok(
    listed.result.tools.every((tool) => tool.name.startsWith("search_")),
  );
  const denied = await message(
    await f.request(call("read_judgment", { citation: "[2026] SGCA 1" })),
  );
  assert.ok(denied.error || denied.result?.isError);
  assert.equal(f.upstream, 0);
});

test("untrusted origins, missing tokens and cookie-only authentication never reach the corpus", async (t) => {
  const f = fixture(t);
  await f.approve();
  assert.equal(
    (await f.request(call(), { headers: { origin: "https://evil.test" } }))
      .status,
    403,
  );
  assert.equal((await f.request(call(), { token: "" })).status, 401);
  assert.equal(
    (
      await f.request(call(), {
        headers: { authorization: "", cookie: "session=fake" },
      })
    ).status,
    401,
  );
  assert.equal(f.upstream, 0);
});

test("strict tool arguments block URL traversal, arbitrary endpoints and excessive output sizes", async (t) => {
  const f = fixture(t);
  await f.approve();
  for (const [name, args] of [
    ["read_judgment", { citation: ".." }],
    ["read_judgment", { citation: "https://evil.test" }],
    ["read_judgment", { citation: "[2026] SGCA 1", length: 20001 }],
    ["search_documents", { kind: "private-notes", query: "x" }],
    ["search_judgments", { query: "x", url: "https://evil.test" }],
  ]) {
    const result = await message(await f.request(call(name, args)));
    assert.ok(result.error || result.result?.isError);
  }
  assert.equal(f.upstream, 0);
});

test("malformed, oversized and batched JSON are rejected without calling the corpus", async (t) => {
  const f = fixture(t);
  await f.approve();
  assert.equal((await f.request("{")).status, 400);
  assert.equal((await f.request(" ".repeat(32769))).status, 400);
  assert.equal(
    (await f.request(call(), { headers: { "content-type": "text/plain" } }))
      .status,
    415,
  );
  const batch = await f.request([call(), call()]);
  const result = await message(batch);
  assert.ok(batch.status >= 400 || result.error);
  assert.equal(f.upstream, 0);
});

test("audit records no search terms, identifiers, tokens, source text or raw provider errors", async (t) => {
  const f = fixture(t);
  await f.approve();
  const secret = "confidential client acquisition";
  f.deps.fetcher = async () =>
    Response.json({ body: "private-looking source response" }, { status: 200 });
  await f.request(call("search_judgments", { query: secret }));
  const audit = JSON.stringify(await f.store.activity("owner"));
  for (const value of [secret, key, "private-looking source response"])
    assert.ok(!audit.includes(value));
  assert.ok(audit.includes("search_judgments"));
  assert.ok(audit.includes("success"));
  f.deps.fetcher = async () => {
    throw new Error(key + " " + secret);
  };
  const error = await message(await f.request(call()));
  assert.equal(error.result.isError, true);
  assert.ok(!JSON.stringify(error).includes(secret));
  assert.ok(!JSON.stringify(error).includes(key));
});

test("retention purges old audit rows and admin changes are separately attributable", async (t) => {
  const f = fixture(t);
  await f.approve();
  const id = await f.store.record(
    { id: "key-owner", userId: "owner" },
    "search_judgments",
    "success",
  );
  f.sql
    .prepare("UPDATE mcp_activity SET createdAt=? WHERE id=?")
    .run(Date.now() - MCP_RETENTION_MS - 1, id);
  assert.equal((await f.store.activity("owner")).length, 0);
  await f.store.record(
    { id: "key-owner", userId: "owner" },
    "tools/list",
    "success",
  );
  assert.equal(
    f.sql.prepare("SELECT COUNT(*) AS n FROM mcp_activity").get().n,
    1,
  );
  const changes = await f.store.audit();
  assert.equal(changes.length, 1);
  assert.equal(changes[0].actor, "admin@example.test");
});

for (const mode of ["legacy", "auto"])
  test(`official MCP client connects, discovers and calls tools (${mode})`, async (t) => {
    const f = fixture(t);
    await f.approve();
    const client = new Client(
      { name: "lawplain-test", version: "1.0.0" },
      { versionNegotiation: { mode } },
    );
    const transport = new StreamableHTTPClientTransport(
      new URL("https://lawplain.test/mcp"),
      {
        requestInit: { headers: { authorization: "Bearer " + key } },
        fetch: async (input, init) =>
          handleLawplainMcp(new Request(input, init), f.deps),
      },
    );
    t.after(() => client.close());
    await client.connect(transport);
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 8);
    const result = await client.callTool({
      name: "search_judgments",
      arguments: { query: "negligence" },
    });
    assert.ok(result.content.length);
    assert.ok(!result.isError);
    assert.equal(f.upstream, 1);
    if (mode === "auto") assert.equal(client.getProtocolEra(), "modern");
  });

test("corpus transport uses Worker-compatible manual redirects and never follows a redirect", async (t) => {
  const f = fixture(t);
  await f.approve();
  let attempted = 0;
  f.deps.fetcher = async (_url, options) => {
    attempted++;
    assert.equal(options.redirect, "manual");
    return new Response(null, {
      status: 302,
      headers: { location: "https://other.example/collect" },
    });
  };
  const result = await message(await f.request(call()));
  assert.equal(result.result.isError, true);
  assert.equal(attempted, 1);
});

test("oversized upstream responses fail without returning partial JSON", async (t) => {
  const f = fixture(t);
  await f.approve();
  f.deps.fetcher = async () => Response.json({ body: "x".repeat(512001) });
  const result = await message(await f.request(call()));
  assert.equal(result.result.isError, true);
  assert.ok(JSON.stringify(result).length < 1000);
});
