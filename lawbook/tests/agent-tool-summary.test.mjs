import assert from "node:assert/strict";
import test from "node:test";
import { summarizeToolCall } from "../src/lib/agent-tool-summary.ts";

test("equivalent curl searches share one semantic key", () => {
  const first = summarizeToolCall("bash", {
    command:
      'curl -sG "https://backend.lawplain.com/v1/statute-sections/search" --data-urlencode "q=dead 10 years" --data-urlencode "act_id=PDPA2012" --data-urlencode "include_body=true" --data-urlencode "limit=3" | jq ".results"',
  });
  const reordered = summarizeToolCall("bash", {
    command:
      'curl -sG https://backend.lawplain.com/v1/statute-sections/search --data-urlencode "limit=3" --data-urlencode "include_body=true" --data-urlencode "act_id=PDPA2012" --data-urlencode "q=dead 10 years"',
  });

  assert.equal(first.key, reordered.key);
  assert.equal(first.kind, "search");
  assert.equal(
    first.summary,
    "search: dead 10 years (/v1/statute-sections/search)",
  );
});

test("meaningfully different search filters have distinct keys", () => {
  const pdpa = summarizeToolCall("bash", {
    command:
      'curl -sG https://backend.lawplain.com/v1/statute-sections/search --data-urlencode "q=dead 10 years" --data-urlencode "act_id=PDPA2012" --data-urlencode "include_body=true"',
  });
  const otherAct = summarizeToolCall("bash", {
    command:
      'curl -sG https://backend.lawplain.com/v1/statute-sections/search --data-urlencode "q=dead 10 years" --data-urlencode "act_id=ISA1965" --data-urlencode "include_body=true"',
  });
  const snippetOnly = summarizeToolCall("bash", {
    command:
      'curl -sG https://backend.lawplain.com/v1/statute-sections/search --data-urlencode "q=dead 10 years" --data-urlencode "act_id=PDPA2012"',
  });

  assert.notEqual(pdpa.key, otherAct.key);
  assert.notEqual(pdpa.key, snippetOnly.key);
});
