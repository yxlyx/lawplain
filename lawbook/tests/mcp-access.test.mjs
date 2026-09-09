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
  sql.exec(readFileSync("migrations/0025_mcp_research_feedback.sql", "utf8"));
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
  assert.equal(listed.result.tools.length, 5);
  assert.ok(
    listed.result.tools.every(
      (tool) =>
        tool.name.startsWith("search_") || tool.name === "submit_feedback",
    ),
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

test("activity summaries omit research payloads and provider errors never reveal credentials", async (t) => {
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

test("research captures query and reply with correlated IDs, redacts credentials and bounds storage without altering delivery", async (t) => {
  const f = fixture(t);
  await f.approve();
  f.deps.fetcher = async () =>
    Response.json({ body: "source ".repeat(12000) + key });
  const response = await f.request(
    call("search_judgments", { query: "negligence " + key }),
  );
  const id = response.headers.get("x-lawplain-activity-id");
  const reply = await message(response);
  assert.equal(reply.result._meta["lawplain/activityId"], id);
  assert.ok(reply.result.content[1].text.includes(id));
  assert.ok(reply.result.content[0].text.length > 64000);
  const record = await f.store.research(id, "owner");
  assert.ok(record.requestText.includes("negligence"));
  assert.ok(record.requestText.includes("[redacted key]"));
  assert.ok(!record.requestText.includes(key));
  assert.ok(record.replyText.includes("source"));
  assert.equal(record.replyText.length, 64000);
  assert.equal(record.truncated, 1);
  assert.equal(await f.store.research(id, "other"), null);
  assert.ok(await f.store.research(id));
  assert.equal((await f.store.activity("owner"))[0].hasResearch, 1);
});

test("feedback tool persists explicit feedback and shared answers, enforces ownership, clears and expires with research", async (t) => {
  const f = fixture(t);
  await f.approve();
  await f.approve("other");
  const response = await f.request(call());
  const activityId = response.headers.get("x-lawplain-activity-id");
  await response.text();
  const args = {
    activityId,
    rating: "not_helpful",
    comment: "Missing an authority " + key,
    sharedAnswer: "Explicitly shared test answer",
  };
  const foreign = await message(
    await f.request(call("submit_feedback", args), { token: otherKey }),
  );
  assert.equal(foreign.result.isError, true);
  const saved = await message(await f.request(call("submit_feedback", args)));
  assert.equal(saved.result.isError, false);
  const record = await f.store.research(activityId, "owner");
  assert.equal(record.rating, "not_helpful");
  assert.equal(record.sharedAnswer, args.sharedAnswer);
  assert.ok(!record.comment.includes(key));
  assert.equal((await f.store.activity(undefined, "not_helpful")).length, 1);
  assert.equal((await f.store.activity("other", "not_helpful")).length, 0);
  assert.equal(
    await f.store.feedback("owner", { ...args, comment: "x".repeat(2001) }),
    false,
  );
  const cleared = await message(
    await f.request(call("submit_feedback", { activityId, rating: null })),
  );
  assert.equal(cleared.result.isError, false);
  const empty = await f.store.research(activityId, "owner");
  assert.equal(empty.rating, null);
  assert.equal(empty.comment, null);
  assert.equal(empty.sharedAnswer, null);
  f.sql
    .prepare("UPDATE mcp_activity SET createdAt=? WHERE id=?")
    .run(Date.now() - MCP_RETENTION_MS - 100, activityId);
  assert.equal(await f.store.feedback("owner", args), false);
  assert.equal(await f.store.research(activityId, "owner"), null);
  await f.store.purge();
  assert.equal(
    f.sql.prepare("SELECT count(*) AS n FROM mcp_research").get().n,
    0,
  );
});

test("discovery and rejected methods never create research snapshots", async (t) => {
  const f = fixture(t);
  await f.approve();
  await f.request({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: { secret: key },
  });
  await f.request(call("unknown", { query: "private text" }));
  assert.equal(
    f.sql.prepare("SELECT count(*) AS n FROM mcp_research").get().n,
    0,
  );
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
    assert.equal(listed.tools.length, 9);
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

test("published MCP guide examples match schemas and its SDK example connects", async (t) => {
  const { MCP_GUIDE } = await import("../src/lib/mcp-guide.ts");
  const f = fixture(t);
  await f.approve();
  const blocks = [...MCP_GUIDE.matchAll(/```(\w+)\n([\s\S]*?)```/g)];
  const configs = blocks
    .filter((b) => b[1] === "json")
    .map((b) => JSON.parse(b[2]));
  assert.equal(
    configs[0].mcpServers.lawplain.headers.Authorization,
    "Bearer ${LAWPLAIN_API_KEY}",
  );
  assert.equal(
    configs[1].mcpServers.lawplain.headers.Authorization,
    "Bearer ${env:LAWPLAIN_API_KEY}",
  );
  const output = [];
  class GuideTransport extends StreamableHTTPClientTransport {
    constructor(url, options) {
      assert.equal(url.href, "https://lawplain.com/mcp");
      super(url, {
        ...options,
        fetch: (input, init) =>
          handleLawplainMcp(new Request(input, init), f.deps),
      });
    }
  }
  const code = blocks
    .find((b) => b[1] === "javascript")[2]
    .replace(/^import .*;\n/, "");
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  await new AsyncFunction(
    "Client",
    "StreamableHTTPClientTransport",
    "process",
    "console",
    code,
  )(
    Client,
    GuideTransport,
    { env: { LAWPLAIN_API_KEY: key } },
    { log: (value) => output.push(value) },
  );
  assert.equal(output[0].tools.length, 9);
  for (const tool of output[0].tools) {
    const row = MCP_GUIDE.split("\n").find((line) =>
      line.startsWith(`| ${tool.name} |`),
    );
    assert.ok(row, `Missing documentation for ${tool.name}`);
    const cells = row.split("|").map((cell) => cell.trim());
    assert.deepEqual(
      cells[2].split(", ").sort(),
      [...(tool.inputSchema.required ?? [])].sort(),
    );
    const optional = Object.keys(tool.inputSchema.properties).filter(
      (name) => !tool.inputSchema.required.includes(name),
    );
    assert.deepEqual(
      cells[3] === "—" ? [] : cells[3].split(", ").sort(),
      optional.sort(),
    );
  }
  assert.ok(output[1].length);
  assert.equal(f.upstream, 1);
});
