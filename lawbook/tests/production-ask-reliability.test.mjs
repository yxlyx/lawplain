import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { researchToolCallBudget } from "../src/lib/agent-budget.ts";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("research budgets match the smallest sufficient evidence plan", () => {
  assert.equal(
    researchToolCallBudget("Does the PDPA apply five years after death?"),
    1,
  );
  assert.equal(
    researchToolCallBudget(
      "Does the PDPA apply to archive records from 1920 and 2010?",
    ),
    2,
  );
  assert.equal(
    researchToolCallBudget("What security obligations does the PDPA impose?"),
    3,
  );
  assert.equal(
    researchToolCallBudget("What does PDPC guidance say about NRIC login?"),
    3,
  );
  assert.equal(
    researchToolCallBudget(
      "Is the PDPC guidance a binding legal requirement under an Act?",
    ),
    4,
  );
  assert.equal(
    researchToolCallBudget("What must a plaintiff prove in defamation?"),
    3,
  );
  assert.equal(researchToolCallBudget("When is a contract frustrated?"), 4);
  assert.equal(
    researchToolCallBudget("Compare several authorities on frustration."),
    6,
  );
  assert.equal(
    researchToolCallBudget(
      "Compare [2020] SGCA 119 with [2020] SGCA 4 on penalty clauses.",
    ),
    1,
  );
});

test("pinned sources use one call unless the user requests a comparison", () => {
  const context = { citation: "[2024] SGCA 1", title: "Example v Example" };
  assert.equal(
    researchToolCallBudget("What did this case decide?", context),
    1,
  );
  assert.equal(
    researchToolCallBudget("Compare this with several other cases.", context),
    6,
  );
});

test("follow-ups inherit the known PDPA one-call plan", () => {
  assert.equal(
    researchToolCallBudget("What about after 11 years?", undefined, [
      { role: "user", text: "How does the PDPA apply to deceased people?" },
    ]),
    1,
  );
});

test("the agent stops after a rejected call and avoids known-Act title search", () => {
  const agent = read("src/lib/agent.ts");
  assert.match(agent, /If any tool call is rejected for budget or duplication/);
  assert.match(agent, /STOP calling tools/);
  assert.match(agent, /Never react to a\s+rejection by retrying/);
  assert.match(agent, /the Act is already\s+identified as PDPA2012/);
  assert.match(
    agent,
    /Never call\s+\/v1\/statutes\/search to rediscover the Act/,
  );
});

test("two exact judgments use one focused evidence batch without narration", () => {
  const agent = read("src/lib/agent.ts");
  assert.match(agent, /\/v1\/judgments\/\{citation\}\/extract\?q=&tokens=350/);
  assert.match(agent, /exactly ONE tool call/);
  assert.match(agent, /do not fetch either full judgment/i);
  assert.match(
    agent,
    /Emit no assistant prose before all permitted tool calls finish/,
  );
});

test("Durable Object retries are isolate-local, bounded, and reconnectable", () => {
  const durable = read("src/server/ask-run-do.ts");
  assert.match(durable, /private looping = false/);
  assert.doesNotMatch(durable, /storage\.get<boolean>\("looping"\)/);
  assert.match(durable, /MAX_RUN_ATTEMPTS = 3/);
  assert.match(durable, /runAttempts/);
  assert.match(durable, /ensureRunningAlarm/);
  assert.match(durable, /storage\.getAlarm\(\)/);
  assert.match(durable, /hasPriorEvents/);
  assert.match(durable, /recovering \? Date\.now\(\) : startedAt/);
  assert.match(durable, /Previous research was interrupted; retrying safely/);
  assert.match(durable, /Failed to remove interrupted Ask sandbox/);
});
