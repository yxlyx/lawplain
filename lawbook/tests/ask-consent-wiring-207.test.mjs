/**
 * #207 — the consent payload actually reaching /api/ask.
 *
 * #200 shipped the model, the assembly and the control; the wire between them
 * was missing, so private notes could not reach a model at all. This checks the
 * wire exists *and* that it did not route around the guarantees #200 tested.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const agent = readFileSync("src/components/AskAgent.tsx", "utf8");
const route = readFileSync("src/app/api/ask/route.ts", "utf8");

test("the composer sends this question's consent, and nothing sticky", () => {
  assert.match(agent, /onConsentChange=\{\(consent\) => \{/);
  assert.match(agent, /privateNotesConsentRef\.current = consent;/);
  assert.match(agent, /consent: privateNotesConsentRef\.current,/);
  // A ref, so an abandoned dialog leaves nothing behind and no re-render occurs.
  assert.match(
    agent,
    /const privateNotesConsentRef = useRef<unknown \| null>\(null\)/,
  );
  assert.match(agent, /an abandoned dialog leaves nothing/);
  assert.doesNotMatch(
    agent,
    /localStorage[^\n]*consent|consent[^\n]*localStorage/i,
  );
});

test("the route treats the client's claim as a request, not a grant", () => {
  assert.match(route, /consentInput = body\.consent;/);
  // Fails closed through the tested normaliser rather than reading fields raw.
  assert.match(route, /normalizeConsent\(consentInput\)/);
  // Ownership is re-checked server-side for every id.
  assert.match(
    route,
    /loadConsentedContext\(\s*session\.user\.id,\s*consent,?\s*\)/,
  );
  assert.match(route, /a request, never a grant/);
});

test("provenance survives into the prompt", () => {
  // Blocks are labelled and cited, never pre-merged into one paragraph.
  assert.match(route, /toContextBlocks\(items, consent, urls\)/);
  assert.match(route, /block\.provenance/);
  assert.match(route, /block\.ref/);
  assert.match(route, /Never present a note/);
  assert.match(route, /cite each claim back to the ref/);
  // The caveat ships with it.
  assert.match(route, /buildManifest\(items, consent\)\.caveat/);
});

test("logs still see counts and refs, never note text", () => {
  assert.match(route, /redactForLogs\(blocks\)/);
  // Any log that touches the assembled context must go through redactForLogs;
  // nothing may hand a console the blocks, the items, or the prompt text.
  const logged = [
    ...route.matchAll(/console\.(info|log|warn|error)\(([^\n]*)/g),
  ].map((m) => m[2]);
  for (const line of logged) {
    // Only the logged *values* matter. A message that happens to contain the
    // word "consent" is prose, not an exposure.
    const values = line.replace(/"[^"]*"|'[^']*'|`[^`]*`/g, "");
    if (!/privateNotes|blocks|items|consent/.test(values)) continue;
    assert.match(
      values,
      /redactForLogs\(/,
      `a log statement exposes consented content unredacted: ${line}`,
    );
  }
});

test("losing the notes never takes the question down with it", () => {
  assert.match(route, /Losing the notes is the safe failure/);
  assert.match(route, /let privateNotes = "";/);
  // An un-consented request contributes an empty string, so the prompt is
  // byte-identical to one from a reader who never opted in.
  assert.match(
    route,
    /composePrompt\(question, context, history\) \+ privateNotes/,
  );
});
