import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Ask grounds time-sensitive and exact-citation answers", () => {
  const agent = read("src/lib/agent.ts");
  assert.match(agent, /Today's date is \$\{currentDate\}/);
  assert.match(agent, /EXACT CITATION FAST PATH/);
  assert.match(agent, /Never infer that a syntactically/);
  assert.match(agent, /future-dated/);
});

test("Ask reconciles Bill records with enacted uncommenced Acts", () => {
  const agent = read("src/lib/agent.ts");
  assert.match(agent, /BILL LIFECYCLE FAST PATH/);
  assert.match(agent, /kind=act_uncommenced Act/);
  assert.match(agent, /enacted but not commenced/);
  assert.match(agent, /outranks stale Bill-stage metadata/);
});

test("Ask preserves a legally accurate source hierarchy", () => {
  const agent = read("src/lib/agent.ts");
  assert.match(agent, /SOURCE HIERARCHY/);
  assert.match(agent, /binding holdings of controlling courts are law too/);
  assert.match(agent, /Never say that legislation is/);
  assert.match(agent, /holding from dicta/);
  assert.match(agent, /question expressly left open/);
});

test("two-case comparisons batch independent source retrieval", () => {
  const agent = read("src/lib/agent.ts");
  assert.match(agent, /TWO-AUTHORITY COMPARISON FAST PATH/);
  assert.match(agent, /exactly ONE tool call/);
  assert.match(agent, /focused extract for each exact API id/);
  assert.match(agent, /do not fetch either full judgment/i);
});

test("graff output cannot report success when it visibly cuts off", () => {
  const run = read("src/server/graff-run.ts");
  assert.match(run, /export function isLikelyCompleteAnswer/);
  assert.match(run, /unclosed Markdown fence|match\(\/```/);
  assert.match(run, /The research output ended before the answer was complete/);
  assert.match(run, /if \(!isLikelyCompleteAnswer\(this\.finalText\)\)/);
});

test("client-side Ask startup failures retain a safe diagnostic stage", () => {
  const ask = read("src/components/AskAgent.tsx");
  assert.match(ask, /let requestStage = "preparing"/);
  assert.match(ask, /requestStage = "requesting research"/);
  assert.match(ask, /Ask client failed while \$\{requestStage\}/);
  assert.match(ask, /err\.message\.slice\(0, 300\)/);
});
