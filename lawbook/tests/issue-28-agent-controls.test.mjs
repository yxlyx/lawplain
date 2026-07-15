import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeToolRejected } from "../src/lib/agent-event-normalizer.ts";
import {
  ReasoningSanitizer,
  sanitizeAnswer,
} from "../src/lib/reasoning-sanitizer.ts";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("reasoning sanitizer removes complete, split, and unterminated think blocks", () => {
  assert.equal(
    sanitizeAnswer("before<think>secret</think>after"),
    "beforeafter",
  );
  const split = new ReasoningSanitizer();
  assert.equal(split.push("answer<th"), "answer");
  assert.equal(split.push("ink>hidden</thi"), "");
  assert.equal(split.push("nk> done"), " done");
  assert.equal(split.finish(), "");
  const unterminated = new ReasoningSanitizer();
  assert.equal(unterminated.push("safe<think>never expose"), "safe");
  assert.equal(unterminated.finish(), "");
});

test("tool rejection is normalized to the typed event", () => {
  assert.deepEqual(
    normalizeToolRejected({ name: "bash", reason: "duplicate" }),
    {
      type: "tool_rejected",
      name: "bash",
      reason: "duplicate",
      message: "Tool call rejected (duplicate)",
    },
  );
});

test("sandbox and local SDK execution enforce the same tool controls", () => {
  const agent = read("src/lib/agent.ts");
  const durable = read("src/server/graff-run.ts");
  for (const source of [agent, durable]) {
    assert.match(source, /--max-tool-calls/);
    assert.match(source, /--dedupe-tool-calls/);
  }
  assert.match(agent, /TOOL_CALL_BUDGET/);
  assert.match(durable, /TOOL_CALL_BUDGET/);
  assert.match(durable, /Math\.min\(6, Math\.max\(1/);
});

test("sandbox runtime is pinned and verifies the published release checksum", () => {
  const source = read("src/lib/cubesandbox.ts");
  assert.match(
    source,
    /releases\/download\/v0\.0\.200\/graff-x86_64-linux\.tar\.gz/,
  );
  assert.match(
    source,
    /3fefe2bc01edd64f4974e0c9a529cab0b7ebd0cb0da5ef2e30c4d256d1856351/,
  );
  assert.match(source, /sha256sum/);
});

test("benchmark uses the fixed legal fixture and requires an explicit paid-run opt in", () => {
  const fixture = JSON.parse(
    read("benchmarks/fixtures/defamation-elements.json"),
  );
  const script = read("scripts/benchmark-ask.mjs");
  assert.equal(
    fixture.question,
    "What must a plaintiff prove in a defamation claim?",
  );
  assert.match(script, /LAWPLAIN_BENCHMARK_RUN !== "yes"/);
  assert.deepEqual(fixture.expectations.answerTerms, [
    "defamatory",
    "reference",
    "publication",
  ]);
  assert.match(script, /duplicateToolCalls/);
  assert.match(script, /rejectedToolCalls/);
  assert.match(script, /doneEvents\.length !== 1/);
  assert.match(script, /expectationScore/);
  assert.match(script, /citationCount/);
  assert.doesNotMatch(script, /API_KEY|Authorization/);
});
