import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const agent = readFileSync("src/lib/agent.ts", "utf8");
const client = readFileSync("src/lib/sgjudge.ts", "utf8");

test("statutory research searches provision bodies before answering scope questions", () => {
  assert.match(agent, /\/v1\/statute-sections\/search\?q=&act_id=&limit=/);
  assert.match(agent, /a title hit alone does NOT answer the/);
  assert.match(agent, /scope, application, exclusions, exceptions, dates/);
  assert.match(
    agent,
    /operative rule and any nearby\s+exception or qualification/,
  );
  assert.match(agent, /at most one shorter section\s+search with synonyms/);
});

test("the typed client exposes provision-level search", () => {
  assert.match(client, /export interface StatuteSectionHit extends SearchHit/);
  assert.match(client, /searchStatuteSections:/);
  assert.match(client, /"\/v1\/statute-sections\/search"/);
  assert.match(client, /act_id\?: string/);
});
