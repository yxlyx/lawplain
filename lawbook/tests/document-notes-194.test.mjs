/**
 * Issue #194 — private document notes with optional legal brief templates.
 *
 * The template helpers are pure, so they are executed here rather than pattern
 * matched: "switching modes cannot silently discard text" is a behaviour, and a
 * regex over source cannot tell whether it holds.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  applyTemplate,
  DOCUMENT_NOTE_TEMPLATES,
  FREE_FORM_TEMPLATE_ID,
  isDocumentNoteTemplateId,
  isScaffoldOnly,
  resolveDocumentNoteTemplate,
  templatesForDocType,
} from "../src/lib/document-note-templates.ts";

const migration = readFileSync("migrations/0022_document_notes.sql", "utf8");
const notes = readFileSync("src/lib/document-notes.ts", "utf8");
const annotations = readFileSync("src/lib/private-annotations.ts", "utf8");
const route = readFileSync("src/app/api/document-notes/route.ts", "utf8");
const hook = readFileSync("src/hooks/useDocumentNote.ts", "utf8");
const panel = readFileSync("src/components/DocumentNotes.tsx", "utf8");
const judgmentPage = readFileSync(
  "src/app/judgment/[citation]/page.tsx",
  "utf8",
);
const statutePage = readFileSync(
  "src/app/statute/[reference]/page.tsx",
  "utf8",
);

const MIGRATIONS = [
  "0004_saved_workspace.sql",
  "0007_expand_saved_authority_doc_types.sql",
  "0017_saved_quotes.sql",
  "0020_private_research_foundation.sql",
  "0021_annotation_labels.sql",
  "0022_document_notes.sql",
];

function migratedDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE user (id TEXT PRIMARY KEY)");
  for (const name of MIGRATIONS)
    db.exec(readFileSync(`migrations/${name}`, "utf8"));
  db.prepare("INSERT INTO user VALUES (?)").run("owner");
  db.prepare("INSERT INTO user VALUES (?)").run("other");
  return db;
}

/**
 * Executes every SQL template in the notes data layer against the real migrated
 * schema, for the same reason private-annotations.ts is checked this way: these
 * statements only ever run through D1 in production, so an arity or column
 * mistake would otherwise reach users as a runtime failure on every save.
 */
test("every document-note statement prepares against the real schema", () => {
  const db = migratedDb();
  const statements = [...notes.matchAll(/\.prepare\(`([\s\S]*?)`\)/g)].map(
    (match) =>
      match[1].replace(
        /\$\{SELECT_NOTE\}/g,
        notes.match(/const SELECT_NOTE = `([\s\S]*?)`;/)[1],
      ),
  );
  assert.ok(statements.length >= 6, "expected the full notes data layer");
  const failures = [];
  for (const sql of statements) {
    try {
      db.prepare(sql);
    } catch (error) {
      failures.push(`${sql.trim().split("\n")[0]} -> ${error.message}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("one note per document is enforced by the schema, not by the client", () => {
  const db = migratedDb();
  db.prepare(`INSERT INTO saved_authorities
    (id,userId,docType,docId,title,path,createdAt,updatedAt,citation,savedAt,
     activityAt)
    VALUES ('auth1','owner','judgment','doc','T','/judgment/doc',10,10,'C',
      NULL,10)`).run();
  const insert = db.prepare(`INSERT INTO document_notes
    (id,userId,authorityId,title,citation,path,body,template,createdAt,updatedAt)
    VALUES (?, 'owner','auth1','T','C','/judgment/doc',?, 'free',10,10)`);
  insert.run("n1", "first");
  assert.throws(() => insert.run("n2", "second"), /UNIQUE/);

  // A note can never point at another owner's authority root.
  assert.throws(
    () =>
      db
        .prepare(`INSERT INTO document_notes
        (id,userId,authorityId,title,citation,path,body,template,createdAt,
         updatedAt)
        VALUES ('n3','other','auth1','T','C','/judgment/doc','x','free',10,10)`)
        .run(),
    /FOREIGN KEY/,
  );
});

test("deleting an account takes its document notes with it", () => {
  const db = migratedDb();
  db.prepare(`INSERT INTO saved_authorities
    (id,userId,docType,docId,title,path,createdAt,updatedAt,citation,savedAt,
     activityAt)
    VALUES ('auth1','owner','judgment','doc','T','/judgment/doc',10,10,'C',
      10,10)`).run();
  db.prepare(`INSERT INTO document_notes
    (id,userId,authorityId,title,citation,path,body,template,createdAt,updatedAt)
    VALUES ('n1','owner','auth1','T','C','/judgment/doc','mine','free',10,10)`).run();
  db.prepare("DELETE FROM user WHERE id='owner'").run();
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM document_notes").get().n,
    0,
  );
});

test("an empty body is rejected by the schema too", () => {
  const db = migratedDb();
  db.prepare(`INSERT INTO saved_authorities
    (id,userId,docType,docId,title,path,createdAt,updatedAt,citation,savedAt,
     activityAt)
    VALUES ('auth1','owner','judgment','doc','T','/judgment/doc',10,10,'C',
      NULL,10)`).run();
  assert.throws(
    () =>
      db
        .prepare(`INSERT INTO document_notes
        (id,userId,authorityId,title,citation,path,body,template,createdAt,
         updatedAt)
        VALUES ('n1','owner','auth1','T','C','/judgment/doc','','free',10,10)`)
        .run(),
    /CHECK/,
  );
});

test("a document note is one per authority, owner-bound, and permanent", () => {
  assert.match(migration, /CREATE TABLE document_notes/);
  assert.match(
    migration,
    /FOREIGN KEY \(userId, authorityId\)\s+REFERENCES saved_authorities \(userId, id\) ON DELETE CASCADE/,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX idx_document_notes_owner_authority\s+ON document_notes \(userId, authorityId\)/,
  );
  // Permanent deletion, so there is deliberately no soft-delete column. Check
  // the column list rather than the file, which explains the choice in prose.
  const columns = migration
    .replace(/--[^\n]*/g, "")
    .match(/CREATE TABLE document_notes \(([\s\S]*?)\n\);/)?.[1];
  assert.ok(columns, "could not read the document_notes column list");
  assert.ok(
    !/deletedAt/.test(columns),
    "document notes must not carry a soft-delete column",
  );
  assert.match(migration, /length\(body\) BETWEEN 1 AND 50000/);
});

test("templates are open-ended rather than enum-bound", () => {
  assert.match(migration, /length\(template\) BETWEEN 1 AND 64/);
  // An unknown template id still resolves, so a note never disappears.
  const unknown = resolveDocumentNoteTemplate("template-from-a-later-release");
  assert.equal(unknown.id, "template-from-a-later-release");
  assert.equal(unknown.name, "Other template");
  assert.deepEqual(unknown.headings, []);
  assert.equal(
    isDocumentNoteTemplateId("template-from-a-later-release"),
    false,
  );
  assert.equal(isDocumentNoteTemplateId(FREE_FORM_TEMPLATE_ID), true);
});

test("each document kind offers free form plus its own brief", () => {
  const judgment = templatesForDocType("judgment").map((t) => t.id);
  const statute = templatesForDocType("statute").map((t) => t.id);
  assert.deepEqual(judgment, [FREE_FORM_TEMPLATE_ID, "case-brief"]);
  assert.deepEqual(statute, [FREE_FORM_TEMPLATE_ID, "statute-brief"]);
  const caseBrief = resolveDocumentNoteTemplate("case-brief");
  assert.deepEqual(caseBrief.headings, [
    "Issue",
    "Key facts",
    "Holding / rule",
    "Court's reasoning",
    "My analysis",
    "Authorities to follow up",
  ]);
  assert.equal(resolveDocumentNoteTemplate("statute-brief").headings.length, 7);
  assert.equal(DOCUMENT_NOTE_TEMPLATES.length, 3);
});

test("applying a template never discards or reorders what was written", () => {
  const written = "The court rejected the wider rule.\n\nCheck Tan v Lim.";
  const scaffolded = applyTemplate(written, "case-brief");
  // Every original character survives, in its original order.
  assert.ok(scaffolded.startsWith(written));
  assert.match(scaffolded, /## Issue/);
  assert.match(scaffolded, /## Authorities to follow up/);

  // Free form adds nothing at all, so switching back cannot alter the text.
  assert.equal(applyTemplate(scaffolded, FREE_FORM_TEMPLATE_ID), scaffolded);

  // Re-applying is idempotent: no duplicated headings on a second click.
  assert.equal(applyTemplate(scaffolded, "case-brief"), scaffolded);
});

test("a heading the reader already wrote is not added twice", () => {
  const withHeading = "## Issue\n\nWhether the clause was penal.";
  const scaffolded = applyTemplate(withHeading, "case-brief");
  assert.equal(scaffolded.match(/## Issue/g).length, 1);
  assert.match(scaffolded, /Whether the clause was penal\./);
});

test("an empty note takes the scaffold alone, and is recognisable as empty", () => {
  const scaffolded = applyTemplate("", "statute-brief");
  assert.match(scaffolded, /^## Purpose \/ scope/);
  assert.equal(isScaffoldOnly(scaffolded), true);
  assert.equal(isScaffoldOnly(""), false);
  assert.equal(isScaffoldOnly("## Issue\n\nreal analysis"), false);
});

test("notes are owner-scoped and reject an unknown template", () => {
  assert.match(notes, /export function normalizeDocumentNoteInput/);
  assert.match(notes, /isDocumentNoteTemplateId\(raw\.template\)/);
  // Unknown template => null => the route answers 400 rather than defaulting.
  assert.match(notes, /:\s*null;/);
  assert.match(notes, /!path\.startsWith\(`\/\$\{raw\.docType\}\/`\)/);
  // Every read and write is bound to the owner.
  assert.match(
    notes,
    /WHERE n\.userId = \? AND a\.docType = \? AND a\.docId = \?/,
  );
  assert.match(notes, /ON CONFLICT\(userId, authorityId\) DO UPDATE SET/);
});

test("an emptied editor is never treated as a delete", () => {
  assert.match(notes, /body === null \|\|\s+!body\.trim\(\)/);
  assert.match(hook, /An empty editor is not a delete/);
  assert.match(hook, /if \(!body\.trim\(\)\)/);
});

test("a first note adds the document to My Library without duplicating it", () => {
  assert.match(notes, /INSERT INTO saved_authorities/);
  assert.match(notes, /ON CONFLICT\(userId, docType, docId\) DO UPDATE SET/);
  assert.match(
    annotations,
    /OR EXISTS \(SELECT 1 FROM document_notes n\s+WHERE n\.userId = a\.userId AND n\.authorityId = a\.id\)/,
  );
  assert.match(annotations, /AS documentNoteCount/);
});

test("deleting the last highlight cannot cascade a document note away", () => {
  // Both the guard row and the authority root must survive while a note exists.
  const guards = annotations.match(
    /NOT EXISTS \(SELECT 1 FROM document_notes\s+WHERE userId = \? AND authorityId = \?\)/g,
  );
  assert.ok(
    guards && guards.length >= 2,
    "expected note checks on both deletes",
  );
  assert.match(notes, /AND NOT EXISTS \(SELECT 1 FROM passage_annotations/);
});

test("the note API is private, authenticated, and honest about failure", () => {
  assert.match(route, /privateRoute\(async \(\) =>/);
  assert.match(route, /Authentication required.*401/s);
  assert.match(route, /export async function PUT/);
  assert.match(route, /export async function DELETE/);
  assert.match(route, /STALE_NOTE_WRITE/);
  assert.match(route, /\{ error: "No note to delete" \}, \{ status: 404 \}/);
  assert.match(route, /export const dynamic = "force-dynamic"/);
});

test("the editor warns before navigation and never clobbers a live draft", () => {
  assert.match(hook, /beforeunload/);
  assert.match(hook, /dirtyRef/);
  assert.match(hook, /if \(cancelled \|\| dirtyRef\.current\) return;/);
  assert.match(hook, /AUTOSAVE_DEBOUNCE_MS/);
});

test("the panel is distinct from passage annotations and hidden when signed out", () => {
  assert.match(panel, /My notes on this/);
  assert.match(panel, /Separate from your highlighted passages/);
  assert.match(panel, /if \(!ownerId\) return null;/);
  assert.match(panel, /<output[\s\S]*?aria-live="polite"/);
  assert.match(panel, /Deleting this note cannot be undone/);
});

test("the panel is mounted on both document kinds", () => {
  assert.match(judgmentPage, /<DocumentNotes\s+docType="judgment"/);
  assert.match(statutePage, /<DocumentNotes\s+docType="statute"/);
});
