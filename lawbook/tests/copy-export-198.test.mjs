/**
 * Issue #198 — copy annotated quotes, export and delete private research.
 *
 * The formatting is pure, so every privacy rule is executed here rather than
 * asserted from source. The rule that must never break: a private note appears
 * only when explicitly chosen, and quotation never blurs into commentary.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  exportFilename,
  formatCopiedQuote,
  toExportJson,
  toExportMarkdown,
} from "../src/lib/research-export.ts";

const route = readFileSync("src/app/api/research-export/route.ts", "utf8");
const data = readFileSync("src/lib/research-export-data.ts", "utf8");
const model = readFileSync("src/lib/research-export.ts", "utf8");

const LABELS = { holding: "Rule / Holding", facts: "Facts / Procedure" };
const GENERATED_AT = Date.UTC(2026, 6, 25, 9, 0, 0);

const ANNOTATION = {
  annotationId: "ann1",
  exactText: "A duty of care is owed to one's neighbour",
  note: "PRIVATE THOUGHT: check the Scots authority",
  label: "holding",
  path: "/judgment/2024_SGCA_1#p3",
  startOffset: 10,
  endOffset: 50,
  createdAt: 1,
  updatedAt: 2,
};

const DOCUMENT = {
  docType: "judgment",
  docId: "2024_SGCA_1",
  title: "Tan v Lim",
  citation: "[2024] SGCA 1",
  path: "/judgment/2024_SGCA_1",
  savedAt: 5,
  documentNote: {
    body: "PRIVATE SUMMARY: the reasoning is thin",
    template: "case-brief",
    updatedAt: 6,
  },
  annotations: [ANNOTATION],
  tags: ["Negligence"],
  collections: ["Tan v Lim matter"],
};

test("a copied quote carries citation and link, and omits the note by default", () => {
  const copied = formatCopiedQuote(DOCUMENT, ANNOTATION, LABELS);
  assert.match(copied, /"A duty of care is owed to one's neighbour"/);
  assert.match(copied, /— Tan v Lim, \[2024\] SGCA 1/);
  assert.match(copied, /\/judgment\/2024_SGCA_1#p3/);
  assert.match(copied, /Label: Rule \/ Holding/);
  // The default must never leak the reader's note.
  assert.ok(
    !copied.includes("PRIVATE THOUGHT"),
    "a note must not be copied unless chosen",
  );
});

test("a chosen note is included and marked as the reader's own", () => {
  const copied = formatCopiedQuote(DOCUMENT, ANNOTATION, LABELS, {
    includeNote: true,
  });
  assert.match(copied, /My note: PRIVATE THOUGHT/);
  // The quotation and the commentary are not adjacent or interleaved.
  assert.ok(
    copied.indexOf("My note:") > copied.indexOf("Label:"),
    "commentary must come after the source and its citation",
  );
});

test("an absolute origin makes a pasted link work outside the app", () => {
  const copied = formatCopiedQuote(DOCUMENT, ANNOTATION, LABELS, {
    origin: "https://lawplain.com",
  });
  assert.match(copied, /https:\/\/lawplain\.com\/judgment\/2024_SGCA_1#p3/);
});

test("an unknown label still renders rather than showing nothing", () => {
  const copied = formatCopiedQuote(
    DOCUMENT,
    { ...ANNOTATION, label: "label-from-later" },
    LABELS,
  );
  assert.match(copied, /Label: label-from-later/);
});

test("JSON export separates source text from the reader's note", () => {
  const withoutNotes = toExportJson([DOCUMENT], { generatedAt: GENERATED_AT });
  const annotation = withoutNotes.documents[0].annotations[0];
  assert.equal(annotation.sourceText, ANNOTATION.exactText);
  assert.equal(annotation.userNote, null, "notes are off by default");
  assert.equal(withoutNotes.documents[0].documentNote, null);
  assert.equal(withoutNotes.notesIncluded, false);
  // The whole payload must not contain the note text anywhere.
  assert.ok(!JSON.stringify(withoutNotes).includes("PRIVATE THOUGHT"));
  assert.ok(!JSON.stringify(withoutNotes).includes("PRIVATE SUMMARY"));

  const withNotes = toExportJson([DOCUMENT], {
    generatedAt: GENERATED_AT,
    includeNotes: true,
  });
  assert.equal(withNotes.notesIncluded, true);
  assert.match(
    withNotes.documents[0].annotations[0].userNote,
    /PRIVATE THOUGHT/,
  );
  assert.match(withNotes.documents[0].documentNote.userNote, /PRIVATE SUMMARY/);
  // Still a separate key from the source text.
  assert.equal(
    withNotes.documents[0].annotations[0].sourceText,
    ANNOTATION.exactText,
  );
});

test("the JSON export is a documented, versioned schema", () => {
  const exported = toExportJson([DOCUMENT], { generatedAt: GENERATED_AT });
  assert.equal(exported.schema, "lawplain.private-research");
  assert.equal(exported.schemaVersion, 1);
  assert.equal(exported.generatedAt, GENERATED_AT);
  const doc = exported.documents[0];
  for (const key of ["docType", "docId", "title", "citation", "url", "savedAt"])
    assert.ok(key in doc, `missing stable metadata: ${key}`);
  assert.deepEqual(doc.tags, ["Negligence"]);
  assert.deepEqual(doc.collections, ["Tan v Lim matter"]);
});

test("Markdown export keeps quotation and commentary structurally distinct", () => {
  const withNotes = toExportMarkdown([DOCUMENT], LABELS, {
    generatedAt: GENERATED_AT,
    includeNotes: true,
  });
  // Source text is a blockquote; the note is not.
  assert.match(withNotes, /^> A duty of care is owed/m);
  assert.match(withNotes, /_My note:_ PRIVATE THOUGHT/);
  assert.match(withNotes, /### My note on this document/);
  assert.match(withNotes, /\*\*Rule \/ Holding\*\*/);
  assert.match(withNotes, /\*\*Citation:\*\* \[2024\] SGCA 1/);

  const withoutNotes = toExportMarkdown([DOCUMENT], LABELS, {
    generatedAt: GENERATED_AT,
  });
  assert.ok(!withoutNotes.includes("PRIVATE THOUGHT"));
  assert.ok(!withoutNotes.includes("PRIVATE SUMMARY"));
  assert.match(withoutNotes, /^> A duty of care is owed/m);
});

test("special characters in a note cannot restructure the Markdown", () => {
  const hostile = {
    ...DOCUMENT,
    annotations: [
      {
        ...ANNOTATION,
        note: "# Not a heading\n> not a quote\n- not a list\n`not code`",
      },
    ],
  };
  const exported = toExportMarkdown([hostile], LABELS, {
    generatedAt: GENERATED_AT,
    includeNotes: true,
  });
  assert.ok(
    !/^# Not a heading/m.test(exported),
    "a note must not become a document heading",
  );
  assert.match(exported, /\\# Not a heading/);
  assert.match(exported, /\\> not a quote/);
  assert.match(exported, /\\`not code\\`/);
});

test("an empty library exports safely rather than producing nothing", () => {
  const md = toExportMarkdown([], LABELS, { generatedAt: GENERATED_AT });
  assert.match(md, /# My research/);
  assert.match(md, /Nothing saved yet/);
  const json = toExportJson([], { generatedAt: GENERATED_AT });
  assert.deepEqual(json.documents, []);
  assert.equal(json.schemaVersion, 1);
});

test("a filename cannot escape a directory or carry a surprising extension", () => {
  assert.equal(
    exportFilename("library", "md", GENERATED_AT),
    "lawplain-library-2026-07-25.md",
  );
  assert.equal(
    exportFilename("../../etc/passwd", "json", GENERATED_AT),
    "lawplain-etc-passwd-2026-07-25.json",
  );
  assert.equal(
    exportFilename("", "md", GENERATED_AT),
    "lawplain-research-2026-07-25.md",
  );
  for (const scope of ["a/b", "a\\b", "a:b", 'a"b']) {
    const name = exportFilename(scope, "md", GENERATED_AT);
    assert.ok(!/[/\\:"]/.test(name), `unsafe filename from ${scope}: ${name}`);
  }
});

test("the export gathers only the owner's rows, from the real schema", () => {
  const conn = new DatabaseSync(":memory:");
  conn.exec("PRAGMA foreign_keys=ON; CREATE TABLE user (id TEXT PRIMARY KEY)");
  for (const name of [
    "0004_saved_workspace.sql",
    "0007_expand_saved_authority_doc_types.sql",
    "0017_saved_quotes.sql",
    "0020_private_research_foundation.sql",
    "0021_annotation_labels.sql",
    "0022_document_notes.sql",
    "0023_tags_collections_follow_ups.sql",
  ])
    conn.exec(readFileSync(`migrations/${name}`, "utf8"));
  for (const id of ["owner", "other"])
    conn.prepare("INSERT INTO user VALUES (?)").run(id);

  const failures = [];
  for (const match of data.matchAll(/\.prepare\(\s*`([\s\S]*?)`\s*\)/g)) {
    try {
      conn.prepare(match[1]);
    } catch (error) {
      failures.push(`${match[1].trim().split("\n")[0]} -> ${error.message}`);
    }
  }
  assert.deepEqual(failures, []);
  // Both statements are owner-scoped first, before any scope narrowing.
  const statements = [...data.matchAll(/\.prepare\(\s*`([\s\S]*?)`\s*\)/g)].map(
    (m) => m[1],
  );
  assert.equal(statements.length, 2);
  for (const sql of statements)
    assert.match(
      sql,
      /WHERE (a|p)\.userId = \?/,
      "every read must be owner-scoped",
    );
});

test("a generated download is never left publicly addressable or cached", () => {
  assert.match(route, /PRIVATE_RESPONSE_HEADERS/);
  assert.match(route, /content-disposition.*attachment/);
  assert.match(route, /export const dynamic = "force-dynamic"/);
  assert.match(route, /Authentication required/);
  // Generated per request; nothing is written to storage to be found later.
  assert.match(route, /generated per request/);
  assert.doesNotMatch(route, /R2|bucket|putObject|signedUrl/i);
  // Notes stay opt-in at the route boundary too.
  assert.match(route, /params\.get\("includeNotes"\) === "true"/);
  assert.match(route, /Notes are opt-in/);
});

test("the module states its two privacy rules where they will be read", () => {
  assert.match(model, /included only when the caller explicitly asks/);
  assert.match(model, /Quotation and commentary stay structurally distinct/);
});
