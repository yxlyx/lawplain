// Runs the real Ask Durable Objects in workerd with network access disabled.
// Fleet operations are simulated: this test cannot create billable sandboxes.
const { createRequire } = require("node:module");
const requireApp = createRequire(
  require("node:path").resolve(__dirname, "../package.json"),
);
const { buildSync } = requireApp("esbuild");
const { Miniflare, createFetchMock } = requireApp("miniflare");
const assert = require("node:assert/strict");
const root = require("node:path").resolve(__dirname, "..");
const script = buildSync({
  stdin: {
    contents: `export {AskRunDO} from './src/server/ask-run-do';
export {AskSessionDO} from './src/server/ask-session-do';
export default { async fetch(req,env) {
 const [,kind,id,action]=new URL(req.url).pathname.split('/');
 const namespace=kind==='run'?env.ASK_RUN_DO:env.ASK_SESSION_DO;
 const stub=namespace.get(namespace.idFromName('owner:'+id));
 return stub.fetch(new Request('https://internal/'+action+new URL(req.url).search,req));
}};`,
    resolveDir: root,
    sourcefile: "session-worker-check.ts",
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  external: ["cloudflare:workers"],
  write: false,
}).outputFiles[0].text;
const fetchMock = createFetchMock();
fetchMock.disableNetConnect();
const pool = fetchMock.get("https://api.condensation.ai");
const sid = "cnd_" + "b".repeat(40),
  box = {
    id: sid,
    state: "running",
    expiresAt: Math.floor(Date.now() / 1000) + 1800,
  };
let creates = 0,
  deletes = 0,
  installs = 0,
  launches = 0,
  stops = 0,
  hold = false;
const uploads = new Map();
const options = { headers: { "content-type": "application/json" } };
pool
  .intercept({ path: "/v1/fleet/sandboxes", method: "POST" })
  .reply(
    200,
    () => {
      creates++;
      return JSON.stringify(box);
    },
    options,
  )
  .persist();
pool
  .intercept({ path: "/v1/fleet/sandboxes/" + sid, method: "GET" })
  .reply(200, () => JSON.stringify(box), options)
  .persist();
pool
  .intercept({ path: "/v1/fleet/sandboxes/" + sid, method: "DELETE" })
  .reply(
    200,
    () => {
      deletes++;
      box.state = "terminated";
      return JSON.stringify(box);
    },
    options,
  )
  .persist();
pool
  .intercept({ path: "/v1/fleet/sandboxes/" + sid + "/upload", method: "POST" })
  .reply(
    200,
    async ({ body }) => {
      const b = await new Response(body).json();
      const text = Buffer.from(b.contentBase64, "base64").toString();
      uploads.set(b.path, text);
      if (text.includes("/usr/bin/curl")) installs++;
      if (text.includes("launch.lock")) launches++;
      if (text.includes("touch") && text.includes("stopped")) stops++;
      return "{}";
    },
    options,
  )
  .persist();
pool
  .intercept({ path: "/v1/fleet/sandboxes/" + sid + "/exec", method: "POST" })
  .reply(
    200,
    async ({ body }) => {
      const { command } = await new Response(body).json();
      return JSON.stringify({
        stdout: "graff : OK",
        stderr: "",
        exitCode:
          hold &&
          command.startsWith("test -f") &&
          command.includes("graff.exit")
            ? 1
            : 0,
        truncated: false,
      });
    },
    options,
  )
  .persist();
pool
  .intercept({
    path: "/v1/fleet/sandboxes/" + sid + "/download",
    method: "POST",
  })
  .reply(
    200,
    async ({ body }) => {
      const { path } = await new Response(body).json();
      let content = "";
      if (path.endsWith("/graff.out"))
        content =
          JSON.stringify({
            type: "text",
            text: "This complete answer is grounded in the supplied facts and legal sources.",
          }) + "\n";
      if (path.endsWith("/graff.exit")) content = "0";
      return JSON.stringify({
        contentBase64: Buffer.from(content).toString("base64"),
        bytes: Buffer.byteLength(content),
      });
    },
    options,
  )
  .persist();
(async () => {
  const mf = new Miniflare({
    modules: true,
    script,
    compatibilityDate: "2025-01-01",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: {
      ASK_RUN_DO: { className: "AskRunDO", useSQLite: true },
      ASK_SESSION_DO: { className: "AskSessionDO", useSQLite: true },
    },
    bindings: {
      CONDENSATION_API_KEY: "test-fleet-key",
      LAWPLAIN_SANDBOX_PROVIDER: "condensation",
      LAWPLAIN_ASK_AGENT_ENABLED: "true",
      CODEGRAFF_API_KEY: "test-model-key",
    },
    fetchMock,
  });
  try {
    const headers = {
      "content-type": "application/json",
      "x-lawplain-user-id": "owner",
    };
    for (const runId of Array.from({ length: 20 }, (_, i) =>
      i === 0 ? "first" : "follow-up-" + i,
    )) {
      const start = await mf.dispatchFetch(
        "https://test/run/" + runId + "/start",
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            userId: "owner",
            threadId: "conversation",
            runId,
            question: "test question",
            prompt: "test question",
            systemPrompt: "Be helpful",
            model: "test-model",
          }),
        },
      );
      assert.equal(start.status, 200);
      const stream = await mf.dispatchFetch(
        "https://test/run/" + runId + "/stream",
        { headers, signal: AbortSignal.timeout(25000) },
      );
      const text = await stream.text();
      assert.ok(text.includes('"type":"done"'), text);
      assert.ok(!text.includes('"type":"error"'), text);
      if (runId !== "first") assert.ok(text.includes("Reusing"), text);
      console.log(runId, "completed", {
        creates,
        deletes,
        installs,
        launches,
        stops,
      });
    }
    assert.equal(creates, 1);
    assert.equal(deletes, 0);
    assert.equal(installs, 1);
    assert.equal(launches, 20);
    assert.equal(stops, 20);
    const request = (kind, id, action, body, caller = "owner") =>
      mf.dispatchFetch(`https://test/${kind}/${id}/${action}`, {
        method: "POST",
        headers: { ...headers, "x-lawplain-user-id": caller },
        body: JSON.stringify(body),
      });
    const races = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        request("session", "conversation", "acquire", {
          threadId: "conversation",
          runId: "racer-" + i,
        }),
      ),
    );
    assert.equal(races.filter((r) => r.status === 200).length, 1);
    assert.equal(races.filter((r) => r.status === 409).length, 49);
    const winner = races.findIndex((r) => r.status === 200),
      lease = await races[winner].json();
    assert.equal(creates, 1);
    assert.equal(
      (
        await request(
          "session",
          "conversation",
          "acquire",
          { threadId: "conversation", runId: "bad" },
          "intruder",
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await request("session", "conversation", "release", {
          threadId: "conversation",
          runId: "racer-" + winner,
          sandboxId: lease.sandboxId,
          runtimeReady: true,
        })
      ).status,
      200,
    );
    console.log(
      "PASS: 50 simultaneous requests, one winner, 49 busy, no extra sandbox; ownership enforced.",
    );
    hold = true;
    const startBody = (runId) => ({
      userId: "owner",
      threadId: "conversation",
      runId,
      question: "test",
      prompt: "test",
      systemPrompt: "Be helpful",
      model: "test-model",
    });
    assert.equal(
      (await request("run", "stop-target", "start", startBody("stop-target")))
        .status,
      200,
    );
    const deadline = Date.now() + 10000;
    while (launches < 21 && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 20));
    assert.equal(launches, 21);
    assert.equal((await request("run", "stop-target", "stop", {})).status, 200);
    hold = false;
    assert.equal(
      (await request("run", "after-stop", "start", startBody("after-stop")))
        .status,
      200,
    );
    const after = await mf.dispatchFetch("https://test/run/after-stop/stream", {
      headers,
      signal: AbortSignal.timeout(25000),
    });
    const answer = await after.text();
    assert.ok(answer.includes('"type":"done"'), answer);
    assert.ok(!answer.includes('"type":"error"'), answer);
    assert.equal(creates, 1);
    assert.equal(deletes, 0);
    assert.equal(installs, 1);
    const replay = await mf.dispatchFetch(
      "https://test/run/after-stop/stream",
      { headers },
    );
    assert.equal(await replay.text(), answer);
    const status = await (
      await mf.dispatchFetch("https://test/run/after-stop/status", { headers })
    ).json();
    const empty = await mf.dispatchFetch(
      "https://test/run/after-stop/stream?from=" + status.count,
      { headers },
    );
    assert.equal(await empty.text(), "");
    assert.equal((await request("run", "stop-target", "stop", {})).status, 200);
    assert.equal(deletes, 0);
    console.log(
      "PASS: Stop and immediate follow-up reuse, full SSE replay and resume cursor.",
    );
    const deleted = await mf.dispatchFetch(
      "https://test/session/conversation/dispose",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ threadId: "conversation" }),
      },
    );
    assert.equal(deleted.status, 200);
    assert.equal(deletes, 1);
    assert.equal(
      (
        await request("session", "conversation", "acquire", {
          threadId: "conversation",
          runId: "resurrect",
        })
      ).status,
      410,
    );
    assert.equal(creates, 1);
    console.log("PASS: deletion disposes VM and blocks resurrection.", {
      creates,
      deletes,
      installs,
      launches,
      stops,
    });
  } finally {
    await mf.dispose();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
