/**
 * Issue #200 — explicitly opted-in Ask and private brief generation.
 *
 * The consent model is pure, so every rule is executed. The rule that must never
 * break: private note text cannot reach a model without an explicit per-request
 * opt-in naming exactly what to include.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildManifest,
  LEGAL_CAVEAT,
  MAX_CONSENTED_ITEMS,
  NO_CONSENT,
  normalizeConsent,
  redactForLogs,
  toContextBlocks,
  verifyClaimCitations,
} from "../src/lib/ask-consent.ts";

const route = readFileSync("src/app/api/ask-private-context/route.ts", "utf8");
const assembly = readFileSync("src/lib/ask-private-context.ts", "utf8");
const model = readFileSync("src/lib/ask-consent.ts", "utf8");
const doc = readFileSync("docs/private-notes-and-ask.md", "utf8");

const ITEMS = [
  {
    kind: "annotation",
    id: "ann1",
    title: "Tan v Lim",
    citation: "[2024] SGCA 1",
    label: "holding",
    sourcePreview: "The clause was penal",
    notePreview: "PRIVATE: my own reasoning here",
    hasNote: true,
  },
  {
    kind: "documentNote",
    id: "auth1",
    title: "Tan v Lim",
    citation: "[2024] SGCA 1",
    label: null,
    sourcePreview: null,
    notePreview: "PRIVATE: my case summary",
    hasNote: true,
  },
];

const CONSENT = {
  includePrivateNotes: true,
  annotationIds: ["ann1"],
  documentNoteAuthorityIds: ["auth1"],
};

test("consent is off unless the request says so, literally", () => {
  for (const value of [
    undefined,
    null,
    {},
    "yes",
    { includePrivateNotes: "true", annotationIds: ["a"] },
    { includePrivateNotes: 1, annotationIds: ["a"] },
    { includePrivateNotes: "on", annotationIds: ["a"] },
  ]) {
    assert.deepEqual(
      normalizeConsent(value),
      NO_CONSENT,
      `${JSON.stringify(value)} must not read as consent`,
    );
  }
  assert.equal(normalizeConsent(CONSENT).includePrivateNotes, true);
});

test("consent with nothing named is not consent to everything", () => {
  assert.deepEqual(
    normalizeConsent({ includePrivateNotes: true }),
    NO_CONSENT,
    "an empty scope must mean nothing, not everything",
  );
  assert.deepEqual(
    normalizeConsent({ includePrivateNotes: true, annotationIds: [] }),
    NO_CONSENT,
  );
});

test("malformed or oversized consent fails closed", () => {
  for (const value of [
    { includePrivateNotes: true, annotationIds: "a" },
    { includePrivateNotes: true, annotationIds: [1, 2] },
    { includePrivateNotes: true, annotationIds: [""] },
    { includePrivateNotes: true, annotationIds: ["x".repeat(201)] },
    {
      includePrivateNotes: true,
      annotationIds: Array.from(
        { length: MAX_CONSENTED_ITEMS + 1 },
        (_, i) => `a${i}`,
      ),
    },
  ]) {
    assert.deepEqual(normalizeConsent(value), NO_CONSENT);
  }
  // Duplicates collapse rather than inflating the count.
  assert.deepEqual(
    normalizeConsent({ includePrivateNotes: true, annotationIds: ["a", "a"] })
      .annotationIds,
    ["a"],
  );
});

test("without consent, no note text reaches a context block", () => {
  const blocks = toContextBlocks(ITEMS, NO_CONSENT, {});
  assert.deepEqual(blocks, []);
  // Nothing about the reader's words is present anywhere in the output.
  assert.ok(!JSON.stringify(blocks).includes("PRIVATE"));

  const manifest = buildManifest(ITEMS, NO_CONSENT);
  assert.deepEqual(manifest.items, []);
  assert.equal(manifest.includesNoteText, false);
  assert.ok(!JSON.stringify(manifest).includes("PRIVATE"));
});

test("the manifest shows exactly what would be sent, before sending", () => {
  const manifest = buildManifest(ITEMS, CONSENT);
  assert.equal(manifest.annotationCount, 1);
  assert.equal(manifest.documentNoteCount, 1);
  assert.equal(manifest.includesNoteText, true);
  assert.equal(manifest.items.length, 2);
  for (const item of manifest.items) {
    assert.ok(item.citation, "a reader must see which authority each item is");
  }
  // The caveat travels with the manifest, so output cannot ship without it.
  assert.equal(manifest.caveat, LEGAL_CAVEAT);
  assert.match(manifest.caveat, /not legal advice/);
});

test("source law and the reader's notes are separate, labelled blocks", () => {
  const blocks = toContextBlocks(ITEMS, CONSENT, {
    ann1: "/judgment/x#p1",
    auth1: "/judgment/x",
  });
  const kinds = blocks.map((b) => b.provenance);
  assert.ok(kinds.includes("source_law"));
  assert.ok(kinds.includes("user_note"));
  // No block mixes the two.
  const source = blocks.find((b) => b.provenance === "source_law");
  assert.equal(source.text, "The clause was penal");
  assert.ok(!source.text.includes("PRIVATE"));
  const note = blocks.find((b) => b.provenance === "user_note");
  assert.match(note.text, /PRIVATE: my own reasoning/);
  // Every block carries a citation and a link back.
  for (const block of blocks) {
    assert.ok(block.citation);
    assert.ok(block.ref);
    assert.match(block.url, /^\/judgment\//);
  }
  // A document note contributes no source-law block, since it quotes nothing.
  assert.equal(
    blocks.filter(
      (b) => b.ref.startsWith("auth1") && b.provenance === "source_law",
    ).length,
    0,
  );
});

test("logs and analytics see counts and refs, never a written word", () => {
  const blocks = toContextBlocks(ITEMS, CONSENT, {});
  const summary = redactForLogs(blocks);
  assert.equal(summary.sourceLawBlocks, 1);
  assert.equal(summary.userNoteBlocks, 2);
  assert.equal(summary.blockCount, 3);
  const serialized = JSON.stringify(summary);
  assert.ok(
    !serialized.includes("PRIVATE"),
    "note text leaked into log summary",
  );
  assert.ok(
    !serialized.includes("penal"),
    "source text leaked into log summary",
  );
  assert.deepEqual(summary.refs.sort(), [
    "ann1:note",
    "ann1:source",
    "auth1:note",
  ]);
});

test("an uncited or unknown-ref claim is reported, not presented as grounded", () => {
  const blocks = toContextBlocks(ITEMS, CONSENT, {});
  const good = verifyClaimCitations(
    [{ text: "The clause was penal.", refs: ["ann1:source"] }],
    blocks,
  );
  assert.equal(good.grounded, true);
  assert.deepEqual(good.ungrounded, []);

  const bad = verifyClaimCitations(
    [
      { text: "Uncited assertion.", refs: [] },
      { text: "Invented source.", refs: ["nope:source"] },
      { text: "Fine one.", refs: ["ann1:note"] },
    ],
    blocks,
  );
  assert.equal(bad.grounded, false);
  assert.deepEqual(bad.ungrounded, ["Uncited assertion.", "Invented source."]);
});

test("authorization is rechecked server-side against the session", () => {
  // Every read is filtered by the session's own user id, not by the client's claim.
  assert.match(assembly, /WHERE p\.userId = \? AND p\.deletedAt IS NULL/);
  assert.match(assembly, /WHERE n\.userId = \? AND n\.authorityId IN/);
  assert.match(assembly, /rechecked here, on every request/);
  assert.match(route, /Authorization is rechecked here against the session/);
  assert.match(
    route,
    /loadConsentedContext\(\s*session\.user\.id,\s*consent,?\s*\)/,
  );
  // Un-consented requests do no query at all.
  assert.match(
    assembly,
    /if \(!consent\.includePrivateNotes\) return \{ items: \[\], urls: \{\} \}/,
  );
});

test("cancelling persists no draft and changes no default", () => {
  // There is nowhere to persist consent: no table, no cookie, no storage call.
  assert.doesNotMatch(
    route,
    /INSERT|UPDATE|localStorage|setCookie|cookies\(\)/,
  );
  assert.doesNotMatch(model, /INSERT|UPDATE|localStorage/);
  assert.match(route, /Nothing here is persisted/);
  assert.match(model, /consent is\n \* per request/);
  assert.match(doc, /Closing the dialog or reloading returns to off/);
});

test("a request with no consent explains itself instead of erroring", () => {
  assert.match(route, /includedNothing: true/);
  assert.match(route, /Your notes are not included/);
  assert.match(route, /Turn on “Include my private notes”/);
});

test("provider retention, deletion and failure behaviour are documented", () => {
  assert.match(doc, /## Provider and retention/);
  assert.match(doc, /Is it used for training\?/);
  assert.match(doc, /How long does the provider retain it\?/);
  assert.match(doc, /What happens on deletion\?/);
  assert.match(doc, /## Failure behaviour/);
  assert.match(doc, /Provider unavailable/);
  assert.match(doc, /never written over them/);
  // The two facts that depend on account configuration are flagged as such
  // rather than asserted as if this code could guarantee them.
  assert.match(doc, /Before launch, confirm and record here/);
  assert.match(doc, /cannot be asserted in a test/);
});

test("no standing or remembered opt-in is offered anywhere", () => {
  assert.match(doc, /## What is deliberately not here/);
  assert.match(doc, /No "remember this choice"/);
  for (const source of [route, model, assembly]) {
    assert.doesNotMatch(source, /alwaysAllow|rememberConsent|defaultInclude/i);
  }
});
