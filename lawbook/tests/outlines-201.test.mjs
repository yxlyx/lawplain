/**
 * Issue #201 — annotation-based outlines and authority comparison.
 *
 * An outline is a view over annotations, so the property to prove is that
 * building, grouping and reordering never mutate a source annotation. That is
 * checked by deep-freezing the inputs: any write attempt throws.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildComparison,
  buildOutline,
  COMPARISON_CATEGORIES,
  outlineToMarkdown,
  reorderExcerpt,
} from "../src/lib/research-outline.ts";

const model = readFileSync("src/lib/research-outline.ts", "utf8");

const LABELS = {
  holding: "Rule / Holding",
  issue: "Issue",
  facts: "Facts / Procedure",
  reasoning: "Reasoning",
  exception: "Exception / Counterpoint",
};

function annotation(id, label, text, note = null) {
  return {
    annotationId: id,
    exactText: text,
    note,
    label,
    path: `/judgment/doc#${id}`,
    startOffset: 0,
    endOffset: text.length,
    createdAt: 1,
    updatedAt: 1,
  };
}

function doc(docId, title, annotations, extra = {}) {
  return {
    docType: "judgment",
    docId,
    title,
    citation: `[2024] SGCA ${docId}`,
    path: `/judgment/${docId}`,
    savedAt: 1,
    documentNote: null,
    annotations,
    tags: extra.tags ?? [],
    collections: extra.collections ?? [],
  };
}

const DOCS = [
  doc(
    "1",
    "Tan v Lim",
    [
      annotation("a1", "holding", "The clause was penal", "compare Cavendish"),
      annotation("a2", "issue", "Whether the clause was penal"),
      annotation("a3", "facts", "The parties agreed a fixed sum"),
    ],
    { tags: ["Contract"], collections: ["Matter A"] },
  ),
  doc(
    "2",
    "Ong v Goh",
    [
      annotation("b1", "holding", "The clause was a genuine estimate"),
      annotation("b2", "reasoning", "The sum was proportionate"),
    ],
    { tags: ["Contract", "Damages"] },
  ),
];

/** Recursively freeze, so any write during outline building throws. */
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

test("an outline is built without AI and without touching the source", () => {
  const frozen = deepFreeze(structuredClone(DOCS));
  const outline = buildOutline(frozen, LABELS);
  assert.equal(outline.grouping, "label");
  assert.ok(outline.sections.length > 0);
  // Nothing in the module may reach for a model or the database.
  assert.doesNotMatch(model, /fetch\(|anthropic|openai|getAuthDb|prepare\(/i);
});

test("every excerpt keeps authority metadata and a deep link", () => {
  const outline = buildOutline(DOCS, LABELS, {
    origin: "https://lawplain.com",
  });
  const excerpts = outline.sections.flatMap((s) => s.excerpts);
  assert.equal(excerpts.length, 5);
  for (const excerpt of excerpts) {
    assert.ok(excerpt.title, "missing title");
    assert.ok(excerpt.citation, "missing citation");
    assert.ok(excerpt.docId, "missing docId");
    assert.match(excerpt.url, /^https:\/\/lawplain\.com\/judgment\/doc#/);
    assert.equal(typeof excerpt.annotationId, "string");
  }
});

test("source quotation and the reader's commentary stay separate fields", () => {
  const outline = buildOutline(DOCS, LABELS);
  const withNote = outline.sections
    .flatMap((s) => s.excerpts)
    .find((e) => e.annotationId === "a1");
  assert.equal(withNote.sourceText, "The clause was penal");
  assert.equal(withNote.userNote, "compare Cavendish");
  // Never concatenated into one string.
  assert.ok(!withNote.sourceText.includes("Cavendish"));
});

test("collecting one label produces the classic single-label outline", () => {
  const outline = buildOutline(DOCS, LABELS, { labels: ["holding"] });
  assert.equal(outline.sections.length, 1);
  assert.equal(outline.sections[0].heading, "Rule / Holding");
  assert.deepEqual(
    outline.sections[0].excerpts.map((e) => e.annotationId),
    ["a1", "b1"],
  );
});

test("chosen label order is the section order, and an empty choice still shows", () => {
  const outline = buildOutline(DOCS, LABELS, {
    labels: ["issue", "holding", "exception"],
  });
  assert.deepEqual(
    outline.sections.map((s) => s.heading),
    ["Issue", "Rule / Holding", "Exception / Counterpoint"],
  );
  // The chosen-but-empty label is a visible empty heading, not a silent omission.
  assert.deepEqual(outline.sections[2].excerpts, []);
});

test("grouping by authority, tag and collection all work", () => {
  assert.deepEqual(
    buildOutline(DOCS, LABELS, { grouping: "authority" }).sections.map(
      (s) => s.heading,
    ),
    ["Tan v Lim ([2024] SGCA 1)", "Ong v Goh ([2024] SGCA 2)"],
  );
  const byTag = buildOutline(DOCS, LABELS, { grouping: "tag" });
  assert.deepEqual(
    byTag.sections.map((s) => s.heading),
    ["Contract", "Damages"],
  );
  // A document in two tags contributes to both sections.
  assert.equal(byTag.sections[0].excerpts.length, 5);

  const byCollection = buildOutline(DOCS, LABELS, { grouping: "collection" });
  // The second document is in no collection, so it lands under Ungrouped rather
  // than disappearing from the outline.
  assert.deepEqual(byCollection.sections.map((s) => s.heading).sort(), [
    "Matter A",
    "Ungrouped",
  ]);
});

test("hand-picked passages are the only ones collected", () => {
  const outline = buildOutline(DOCS, LABELS, { annotationIds: ["a2", "b2"] });
  assert.deepEqual(
    outline.sections
      .flatMap((s) => s.excerpts)
      .map((e) => e.annotationId)
      .sort(),
    ["a2", "b2"],
  );
});

test("an empty scope explains itself rather than rendering blank", () => {
  assert.match(
    buildOutline(DOCS, LABELS, { labels: ["nonexistent-label"] }).emptyReason,
    /labels you chose/,
  );
  assert.match(
    buildOutline(DOCS, LABELS, { annotationIds: ["gone"] }).emptyReason,
    /no longer in your research/,
  );
  assert.match(buildOutline([], LABELS).emptyReason, /no highlighted passages/);
});

test("reordering changes the outline and never the source annotation", () => {
  const frozen = deepFreeze(structuredClone(DOCS));
  const outline = buildOutline(frozen, LABELS, { labels: ["holding"] });
  const before = outline.sections[0].excerpts.map((e) => e.annotationId);
  assert.deepEqual(before, ["a1", "b1"]);

  const moved = reorderExcerpt(outline, "Rule / Holding", 0, 1);
  assert.deepEqual(
    moved.sections[0].excerpts.map((e) => e.annotationId),
    ["b1", "a1"],
  );
  // The original outline is untouched, so undo is just keeping the old value.
  assert.deepEqual(
    outline.sections[0].excerpts.map((e) => e.annotationId),
    before,
  );
  // And the source documents are byte-identical.
  assert.deepEqual(frozen, structuredClone(DOCS));
});

test("an out-of-range reorder is ignored rather than corrupting the outline", () => {
  const outline = buildOutline(DOCS, LABELS, { labels: ["holding"] });
  for (const [from, to] of [
    [-1, 0],
    [0, -1],
    [9, 0],
    [0, 9],
  ]) {
    const result = reorderExcerpt(outline, "Rule / Holding", from, to);
    assert.deepEqual(
      result.sections[0].excerpts.map((e) => e.annotationId),
      ["a1", "b1"],
      `reorder ${from}->${to} should be a no-op`,
    );
  }
  // An unknown heading is also a no-op.
  assert.deepEqual(
    reorderExcerpt(outline, "No Such Heading", 0, 1).sections[0].excerpts
      .length,
    2,
  );
});

test("comparison handles two or more authorities and missing categories", () => {
  const { authorities, rows } = buildComparison(DOCS, LABELS);
  assert.deepEqual(
    authorities.map((a) => a.title),
    ["Tan v Lim", "Ong v Goh"],
  );
  // Every row is rectangular: one cell per authority, always.
  for (const row of rows)
    assert.equal(row.cells.length, 2, `row ${row.category} is ragged`);

  const issue = rows.find((r) => r.category === "Issue");
  assert.equal(issue.cells[0].excerpts.length, 1);
  // Missing for the second authority: an empty cell, not a shifted row.
  assert.deepEqual(issue.cells[1].excerpts, []);

  const notes = rows.find((r) => r.category === "My notes");
  assert.equal(notes.cells[0].excerpts[0].userNote, "compare Cavendish");
  assert.deepEqual(notes.cells[1].excerpts, []);

  // Three authorities work as well as two.
  const three = buildComparison([...DOCS, doc("3", "Third", [])], LABELS);
  for (const row of three.rows) assert.equal(row.cells.length, 3);
});

test("comparison categories are the documented ones plus the reader's notes", () => {
  assert.deepEqual(
    COMPARISON_CATEGORIES.map((c) => c.category),
    ["Issue", "Rule / Holding", "Reasoning", "Distinction", "Facts"],
  );
  assert.ok(
    buildComparison(DOCS, LABELS).rows.some((r) => r.category === "My notes"),
  );
});

test("outline Markdown keeps quotation and commentary distinct", () => {
  const outline = buildOutline(DOCS, LABELS, { labels: ["holding"] });
  const withNotes = outlineToMarkdown(outline, { includeNotes: true });
  assert.match(withNotes, /^> The clause was penal$/m);
  assert.match(withNotes, /_My note:_ compare Cavendish/);
  assert.match(withNotes, /— Tan v Lim, \[2024\] SGCA 1/);
  assert.match(withNotes, /\/judgment\/doc#a1/);

  // Notes are opt-in here too, matching the export path in #198.
  const withoutNotes = outlineToMarkdown(outline);
  assert.ok(!withoutNotes.includes("compare Cavendish"));
  assert.match(withoutNotes, /^> The clause was penal$/m);
});

test("an empty outline renders its reason instead of an empty document", () => {
  const empty = buildOutline([], LABELS);
  const md = outlineToMarkdown(empty, { title: "My outline" });
  assert.match(md, /# My outline/);
  assert.match(md, /no highlighted passages/);
});

test("AI synthesis is not offered here; it belongs to the #200 opt-in", () => {
  assert.match(model, /No AI is involved/);
  assert.doesNotMatch(model, /summari[sz]e|generate|prompt/i);
});
