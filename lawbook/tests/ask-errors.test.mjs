import assert from "node:assert/strict";
import test from "node:test";
import {
  askHttpErrorMessage,
  RESEARCH_BUSY,
  RESEARCH_FAILED,
  SIGN_IN_REQUIRED,
} from "../src/lib/ask-errors.ts";

test("expired authentication and capacity limits have actionable messages", () => {
  assert.equal(askHttpErrorMessage(401), SIGN_IN_REQUIRED);
  assert.equal(askHttpErrorMessage(429), RESEARCH_BUSY);
});

test("transport, parsing, and server failures retain the safe generic message", () => {
  for (const status of [0, 200, 400, 403, 500, 503]) {
    assert.equal(askHttpErrorMessage(status), RESEARCH_FAILED);
  }
});
