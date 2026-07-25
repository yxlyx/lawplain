/**
 * Issue #183 — token-sensitivity in cross-statute numerical reasoning, and the
 * section conflation it caused.
 *
 * Two prompts differing only in "nine thousand five hundred dollars" vs "$9500"
 * produced different law: the words form missed the IRDA $15,000 bankruptcy
 * threshold, and the digits form cited Companies Act s 154 (convictions) for a
 * rule that lives in s 148 (undischarged bankrupts).
 *
 * The retrieval half is fixed and executed in the backend repo
 * (d1-worker/tests/fts-query.test.mjs). This file covers the client and prompt
 * half: the agent must be told that a relaxed match is unverified, and must take
 * each section number from the hit it read the rule under.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const agent = readFileSync("src/lib/agent.ts", "utf8");
const client = readFileSync("src/lib/sgjudge.ts", "utf8");

test("relaxed matches are surfaced to the agent as unverified candidates", () => {
  assert.match(agent, /falls back to any-term matching when/);
  assert.match(
    agent,
    /match_mode="any" means no provision matched all your terms/,
  );
  assert.match(agent, /Those hits are candidates, not answers/);
  assert.match(
    agent,
    /rather than citing a provision that merely shares vocabulary/,
  );
});

test("a section number must come from the hit the rule was read under", () => {
  assert.match(agent, /CITE EACH PROVISION FROM ITS OWN HIT/);
  assert.match(
    agent,
    /never from surrounding prose,\s+a neighbouring hit, or memory/,
  );
  // The exact pair that was conflated, so the distinction is stated not implied.
  assert.match(agent, /s 148 restricts undischarged bankrupts/);
  assert.match(
    agent,
    /s 154 disqualifies on conviction for fraud or dishonesty/,
  );
  assert.match(agent, /state which rule came from\s+which section/);
});

test("numeric thresholds are answered from the provision, not hedged or invented", () => {
  assert.match(agent, /MONETARY AND NUMERIC THRESHOLDS/);
  assert.match(agent, /"nine thousand five hundred" all reach a provision/);
  assert.match(
    agent,
    /do not spend calls re-searching the same amount in another\s+format/,
  );
  assert.match(agent, /state the arithmetic/);
  assert.match(agent, /Never hedge that a threshold "may or may not" be met/);
  assert.match(agent, /never assert a threshold you\s+have not retrieved/);
});

test("the typed client carries match_mode and per-provision citations", () => {
  assert.match(client, /match_mode\?: "all" \| "any"/);
  assert.match(client, /candidates to verify rather than answers/);
  assert.match(client, /citation\?: string/);
});

test("the documented provision-hit fields include the new ones", () => {
  assert.match(agent, /heading\?, short_title\?, citation\?, score, snippet/);
  assert.match(agent, /Statute and provision searches also return match_mode/);
});
