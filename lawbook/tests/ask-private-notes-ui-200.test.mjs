/**
 * #200 — the consent control, which is where the privacy contract becomes
 * something a reader can see rather than something the server merely obeys.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync("src/components/AskPrivateNotes.tsx", "utf8");
const agent = readFileSync("src/components/AskAgent.tsx", "utf8");

test("the control is off by default and remembers nothing", () => {
  assert.match(panel, /useState\(false\)/);
  assert.match(panel, /Off by default, and only for this question/);
  // No storage of any kind: a standing consent is the failure mode #200 exists
  // to prevent, so there must be nowhere to put one.
  assert.doesNotMatch(panel, /localStorage|sessionStorage|cookie/i);
  assert.doesNotMatch(panel, /alwaysAllow|rememberConsent|defaultInclude/i);
});

test("turning it off clears the selection rather than parking it", () => {
  assert.match(panel, /function toggle\(next: boolean\)/);
  assert.match(panel, /setChosen\(new Set\(\)\)/);
  assert.match(panel, /re-enabling starts from\n\s*\/\/ nothing/);
});

test("an empty selection means nothing, not everything", () => {
  assert.match(panel, /chosen\.size > 0\n?\s*\?/);
  assert.match(panel, /Nothing selected, so nothing will be included/);
});

test("the reader sees what would be sent, from the server, before sending", () => {
  assert.match(panel, /preview: true/);
  assert.match(panel, /\/api\/ask-private-context/);
  assert.match(panel, /manifest\.annotationCount/);
  assert.match(panel, /will be sent/);
  // Whether note text is included is stated, not implied.
  assert.match(panel, /including your own note text/);
  assert.match(panel, /with no note text/);
  // The legal caveat travels with the manifest and is rendered.
  assert.match(panel, /manifest\.caveat/);
});

test("the control lives with the composer, not in settings", () => {
  assert.match(agent, /<AskPrivateNotes \/>/);
  assert.match(agent, /opt-in per question/);
  assert.match(agent, /there is no standing choice/);
});
