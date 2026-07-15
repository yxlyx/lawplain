import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const agent = readFileSync("src/lib/agent.ts", "utf8");
const client = readFileSync("src/lib/sgjudge.ts", "utf8");

test("statutory research searches provision bodies before answering scope questions", () => {
  assert.match(
    agent,
    /\/v1\/statute-sections\/search\?q=&act_id=&include_body=&limit=/,
  );
  assert.match(agent, /STATUTE FAST PATH/);
  assert.match(agent, /exactly ONE initial provision search/);
  assert.match(agent, /include_body=true and limit=3/);
  assert.match(agent, /A title hit alone does NOT answer/);
  assert.match(agent, /scope, application, exclusions, exceptions, dates/);
  assert.match(
    agent,
    /operative rule and every nearby exception or qualification/,
  );
  assert.match(agent, /at most one shorter section search with synonyms/);
  assert.match(agent, /q=dead 10 years/);
  assert.match(agent, /act_id=PDPA2012/);
  assert.match(agent, /run it ONCE/);
  assert.match(agent, /do not pipe it through jq, sed/);
  assert.match(agent, /do NOT fetch section 24/);
  assert.match(
    agent,
    /do\s+NOT run a title search or fetch that section again/,
  );
});

test("verified PDPA deceased-data questions get a one-call hard budget", () => {
  assert.match(agent, /function researchToolCallBudget/);
  assert.match(agent, /identifiesPdpa && concernsDeceasedData \? 1 : 6/);
  assert.match(
    agent,
    /String\(researchToolCallBudget\(question, context, history\)\)/,
  );
});

test("the typed client exposes provision-level search", () => {
  assert.match(client, /export interface StatuteSectionHit extends SearchHit/);
  assert.match(client, /searchStatuteSections:/);
  assert.match(client, /"\/v1\/statute-sections\/search"/);
  assert.match(client, /act_id\?: string/);
  assert.match(client, /include_body\?: boolean/);
  assert.match(client, /body_text\?: string/);
});
