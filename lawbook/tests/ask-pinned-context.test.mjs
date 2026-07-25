/**
 * "The agent doesn't start" — the Ask handoff from a selected passage.
 *
 * Found by driving production: selecting a passage in a judgment and choosing Ask
 * pinned the *display* citation ("[2020] SGCA 119"). /api/ask resolves `cite`
 * server-side through loadChatContext, which looks a judgment up by its API id
 * ("2020_SGCA_119"), so the pin failed and the run ended before it began:
 *
 *   error: Pinned judgment could not be loaded: [2020] SGCA 119
 *
 * The same mismatch silently dropped the drafted prompt, because Ask reads the
 * draft back under the server-resolved citation.
 *
 * Statutes were unaffected: their `citation` prop is already the act_id.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tools = readFileSync("src/components/SelectionTools.tsx", "utf8");
const askAgent = readFileSync("src/components/AskAgent.tsx", "utf8");
const context = readFileSync("src/lib/ask-context.ts", "utf8");
const judgmentPage = readFileSync(
  "src/app/judgment/[citation]/page.tsx",
  "utf8",
);

const askAbout = tools.slice(
  tools.indexOf("function askAboutSelection"),
  tools.indexOf("return (", tools.indexOf("function askAboutSelection")),
);

test("Ask is pinned by the canonical id the server can resolve", () => {
  assert.match(askAbout, /cite=\$\{encodeURIComponent\(docId\)\}/);
  // The display citation must not be what gets pinned.
  assert.doesNotMatch(
    askAbout,
    /cite=\$\{encodeURIComponent\(citation\)\}/,
    "pinning the display citation makes /api/ask fail to load the document",
  );
});

test("the drafted prompt is stored under the same id Ask reads back", () => {
  assert.match(askAbout, /draft:\$\{askKind\}:\$\{docId\}/);
  assert.doesNotMatch(askAbout, /draft:\$\{askKind\}:\$\{citation\}/);
  // Ask builds the read key from the server-resolved context citation...
  assert.match(
    askAgent,
    /draft:\$\{pinnedContext\?\.kind[\s\S]{0,60}pinnedContext\?\.citation/,
  );
  // ...which for a judgment is the API id, not the neutral citation.
  assert.match(context, /const canonical = j\.citation \|\| cite/);
  assert.match(context, /citation: canonical/);
});

test("a judgment's display citation really does differ from its id", () => {
  // The page hands SelectionTools both, and they are not interchangeable —
  // which is why pinning the wrong one was invisible in review.
  assert.match(
    judgmentPage,
    /citation=\{j\.neutral_cite \|\| j\.citation \|\| decoded\}/,
  );
  assert.match(judgmentPage, /docId=\{decoded\}/);
});

test("the pinned-document failure is still reported rather than swallowed", () => {
  const route = readFileSync("src/app/api/ask/route.ts", "utf8");
  assert.match(route, /Pinned \$\{kind\} could not be loaded/);
});
