import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import {
  CondensationSandbox,
  shellQuote,
} from "../src/lib/condensation-sandbox.ts";
import { CubeSandbox } from "../src/lib/cubesandbox.ts";
import {
  createResearchSandbox,
  sandboxConfigured,
} from "../src/lib/research-sandbox.ts";

const SID = `cnd_${"a".repeat(40)}`;
const KEY = "private-fleet-credential";
const UUID = "bc79ccba-0a49-4587-ab35-819c306d1410";
const reply = (body, status = 200) => Response.json(body, { status });

function mockFetch(t, handler) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, ...init, body });
    assert.equal(new URL(url).origin, "https://api.condensation.ai");
    assert.equal(init.headers.authorization, `Bearer ${KEY}`);
    assert.equal(init.redirect, "error");
    return handler(String(url), init, body);
  });
  return calls;
}

test("production provider selection fails closed and cleanup uses the original provider", () => {
  const legacy = {
    CUBESANDBOX_GATEWAY_URL: "https://legacy.example",
    CUBESANDBOX_TENANT_KEY: "legacy",
  };
  assert.equal(
    sandboxConfigured({ ...legacy, LAWPLAIN_SANDBOX_PROVIDER: "condensation" }),
    false,
  );
  assert.equal(sandboxConfigured({ CONDENSATION_API_KEY: KEY }), true);
  assert.equal(
    sandboxConfigured({ ...legacy, LAWPLAIN_SANDBOX_PROVIDER: "typo" }),
    false,
  );
  const env = {
    ...legacy,
    LAWPLAIN_SANDBOX_PROVIDER: "condensation",
    CONDENSATION_API_KEY: KEY,
  };
  assert.ok(createResearchSandbox(env) instanceof CondensationSandbox);
  const old = createResearchSandbox(env, { existingSandboxId: "old-cube-id" });
  assert.ok(old instanceof CubeSandbox);
  assert.equal(old instanceof CondensationSandbox, false);
});

test("creation uses a stable request ID and a bounded lease without automatic retries", async (t) => {
  const calls = mockFetch(t, () => reply({ id: SID, state: "running" }));
  assert.equal(await new CondensationSandbox(KEY, UUID).createSandbox(), SID);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, {
    requestId: UUID,
    name: "Lawplain research",
    leaseSeconds: 600,
  });
});

test("provider failures do not leak bodies or retry mutations", async (t) => {
  const calls = mockFetch(t, () => reply({ error: `credential=${KEY}` }, 503));
  await assert.rejects(
    new CondensationSandbox(KEY).createSandbox(),
    (error) => {
      assert.match(error.message, /503/);
      assert.ok(!error.message.includes(KEY));
      return true;
    },
  );
  assert.equal(calls.length, 1);
});

test("large prompts and shell metacharacters survive the process adapter as literal values", async (t) => {
  const value =
    "apostrophe ' newline\n$(printf INJECTED) `printf BAD` $PATH " +
    "x".repeat(18000);
  let script;
  const calls = mockFetch(t, (url, _init, body) => {
    if (url.endsWith("/upload")) {
      script = Buffer.from(body.contentBase64, "base64").toString();
      return reply({ ok: true, bytes: script.length });
    }
    assert.ok(body.command.length < 16000);
    assert.ok(!body.command.includes(value));
    assert.equal(body.timeoutSeconds, 60);
    const stdout = execFileSync("/bin/bash", ["-c", script], {
      encoding: "utf8",
    });
    return reply({ stdout, stderr: "", exitCode: 0, truncated: false });
  });
  const result = await new CondensationSandbox(KEY).runProcess(SID, {
    cmd: "/bin/bash",
    args: ["-c", 'printf %s "$PAYLOAD"'],
    envs: { PAYLOAD: value },
    timeoutMs: 60000,
  });
  assert.equal(result.stdout, value);
  assert.equal(result.exitCode, 0);
  assert.ok(!script.includes(KEY));
  assert.equal(calls.length, 2);
  assert.throws(() => shellQuote("invalid\0value"));
});

test("missing exit file remains pending, but network/auth failures remain errors", async (t) => {
  let status = 200;
  const calls = mockFetch(t, () => reply({ exitCode: 1 }, status));
  const sandbox = new CondensationSandbox(KEY);
  assert.equal(await sandbox.readSandboxFile(SID, "/tmp/graff.exit"), null);
  assert.equal(calls.length, 1);
  status = 401;
  await assert.rejects(sandbox.readSandboxFile(SID, "/tmp/graff.exit"), /401/);
});

test("file downloads preserve UTF-8 output and enforce the output cap", async (t) => {
  const content = "A cited answer. § 13 🙂";
  let size = Buffer.byteLength(content);
  mockFetch(t, (url) =>
    url.endsWith("/exec")
      ? reply({ exitCode: 0 })
      : reply({
          contentBase64: Buffer.from(content).toString("base64"),
          bytes: size,
        }),
  );
  const sandbox = new CondensationSandbox(KEY);
  assert.equal(await sandbox.readSandboxFile(SID, "/tmp/graff.out"), content);
  size = 1_000_001;
  await assert.rejects(sandbox.readSandboxFile(SID, "/tmp/graff.out"), /limit/);
});

test("truncated process output is not silently accepted", async (t) => {
  mockFetch(t, (url) =>
    url.endsWith("/upload")
      ? reply({ ok: true })
      : reply({ stdout: "cut off", stderr: "", exitCode: 0, truncated: true }),
  );
  await assert.rejects(
    new CondensationSandbox(KEY).runProcess(SID, { cmd: "echo", args: [] }),
    /limit/,
  );
});

test("cleanup verifies termination and reports unconfirmed deletion", async (t) => {
  let state = "terminated";
  const calls = mockFetch(t, (_url, init) =>
    reply({ id: SID, state: init.method === "DELETE" ? "terminating" : state }),
  );
  const sandbox = new CondensationSandbox(KEY);
  await sandbox.deleteSandbox(SID);
  assert.deepEqual(
    calls.map((call) => call.method),
    ["DELETE", "GET"],
  );
  state = "uncertain";
  await assert.rejects(
    sandbox.deleteSandbox(SID),
    /cleanup is not yet confirmed/,
  );
  await assert.rejects(sandbox.deleteSandbox("../other-account"), /Invalid/);
});
