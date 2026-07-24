import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const MIGRATIONS = [
  "0004_saved_workspace.sql",
  "0007_expand_saved_authority_doc_types.sql",
  "0017_saved_quotes.sql",
  "0020_private_research_foundation.sql",
  "0021_annotation_labels.sql",
];

function migratedDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE user (id TEXT PRIMARY KEY)");
  for (const migration of MIGRATIONS) db.exec(read(`migrations/${migration}`));
  db.prepare("INSERT INTO user VALUES (?)").run("owner");
  db.prepare("INSERT INTO user VALUES (?)").run("other");
  return db;
}

function seedAnnotation(db, { id = "a1", userId = "owner", label } = {}) {
  db.prepare(`INSERT OR IGNORE INTO saved_authorities
    (id,userId,docType,docId,title,path,createdAt,updatedAt,citation,savedAt,
     activityAt)
    VALUES ('auth-'||?,?,'judgment','doc','Title','/judgment/doc',10,10,'C',
      NULL,10)`).run(userId, userId);
  const columns = `(id,userId,authorityId,title,citation,path,exactText,anchor,
    startOffset,endOffset,contextBefore,contextAfter,note,createdAt,updatedAt${
      label === undefined ? "" : ",label"
    })`;
  db.prepare(`INSERT INTO passage_annotations ${columns}
    VALUES (?,?,'auth-'||?,'Title','C','/judgment/doc#p1','text','p1',0,4,
      '','',NULL,10,10${label === undefined ? "" : ",?"})`).run(
    ...(label === undefined
      ? [id, userId, userId]
      : [id, userId, userId, label]),
  );
}

/**
 * Executes every SQL template in the data layer against the real migrated
 * schema. The private-annotation statements are only ever run through D1 in
 * production and are not exercised by the static tests, so an arity or column
 * mistake would otherwise reach users as a runtime failure on every write —
 * which is exactly how createAnnotation shipped with 16 values for 15 columns.
 */
test("every private-annotation statement prepares against the real schema", () => {
  const db = migratedDb();
  const source = read("src/lib/private-annotations.ts");
  const statements = [...source.matchAll(/\.prepare\(`([\s\S]*?)`\)/g)]
    .map((match) => match[1])
    // Two statements interpolate the shared SELECT_ANNOTATION prefix.
    .map((sql) =>
      sql.replace(
        /\$\{SELECT_ANNOTATION\}/g,
        source.match(/const SELECT_ANNOTATION = `([\s\S]*?)`;/)[1],
      ),
    );
  assert.ok(statements.length >= 20, "expected the full data layer");
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

test("the label column defaults existing annotations to the preset label", () => {
  const db = migratedDb();
  seedAnnotation(db, { id: "legacy" });
  assert.equal(
    db.prepare("SELECT label FROM passage_annotations WHERE id='legacy'").get()
      .label,
    "key-point",
  );
});

test("the label column is length-bounded, not enum-bounded", () => {
  const db = migratedDb();
  // #193 proper adds user-defined labels; an enumerated CHECK would force a
  // table rebuild to admit them, so only the length is constrained here.
  seedAnnotation(db, { id: "custom", label: "a-future-user-defined-label" });
  assert.equal(
    db.prepare("SELECT label FROM passage_annotations WHERE id='custom'").get()
      .label,
    "a-future-user-defined-label",
  );
  assert.throws(() =>
    seedAnnotation(db, { id: "too-long", label: "x".repeat(65) }),
  );
});

test("the label index is owner-scoped like every other private read", () => {
  const migration = read("migrations/0021_annotation_labels.sql");
  assert.match(migration, /CREATE INDEX idx_passage_annotations_owner_label/);
  assert.match(migration, /ON passage_annotations \(userId, label/);
});

test("account deletion still cascades to labelled annotations", () => {
  const db = migratedDb();
  seedAnnotation(db, { id: "mine", userId: "owner" });
  db.prepare("DELETE FROM saved_authorities WHERE userId='owner'").run();
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS n FROM passage_annotations WHERE id='mine'")
      .get().n,
    0,
  );
});

test("labels always carry a name and never rely on colour alone", () => {
  const labels = read("src/lib/annotation-labels.ts");
  const css = read("src/app/globals.css");
  for (const id of [
    "key-point",
    "facts",
    "issue",
    "holding",
    "reasoning",
    "exception",
    "follow-up",
  ]) {
    assert.match(
      labels,
      new RegExp(`id: "${id}"`),
      `${id} missing from preset`,
    );
    assert.match(
      css,
      new RegExp(`--annotation-${id}:`),
      `${id} missing a colour token`,
    );
    assert.match(
      css,
      new RegExp(`--annotation-${id}-ink:`),
      `${id} missing its solid companion`,
    );
  }
  // Every entry in the preset declares a display name and a hint, so no
  // surface is ever left with a colour and nothing to read.
  const preset = labels.match(
    /ANNOTATION_LABELS: readonly AnnotationLabel\[\] = \[([\s\S]*?)\n\];/,
  )[1];
  const entries = preset
    .split(/\},\s*\{|^\s*\{|\}\s*$/m)
    .filter((entry) => entry.includes("id:"));
  assert.equal(entries.length, 7);
  for (const entry of entries) {
    assert.match(entry, /name: "/);
    assert.match(entry, /hint: "/);
  }
  // The highlight also carries an underline so it stays perceivable without
  // depending on hue alone.
  assert.match(css, /text-decoration-line: underline/);
});

test("an unrecognised label still renders instead of hiding the passage", () => {
  const labels = read("src/lib/annotation-labels.ts");
  assert.match(labels, /ANNOTATION_LABELS\.find[\s\S]*\?\?\s*\{/);
  assert.match(read("src/app/globals.css"), /--annotation-other:/);
});

test("PATCH accepts only the two mutable fields", () => {
  const route = read("src/app/api/annotations/[id]/route.ts");
  assert.match(route, /key !== "note" && key !== "label"/);
  assert.match(route, /isAnnotationLabelId\(body\.label\)/);
  // Captured source material stays immutable (#189).
  for (const field of ["exactText", "anchor", "startOffset", "contextBefore"]) {
    assert.doesNotMatch(route, new RegExp(`body\\.${field}`));
  }
});

test("an omitted label defaults but an unknown label is rejected", () => {
  const source = read("src/lib/private-annotations.ts");
  assert.match(
    source,
    /raw\.label === undefined\s*\?\s*DEFAULT_ANNOTATION_LABEL_ID/,
  );
  assert.match(source, /isAnnotationLabelId\(raw\.label\)/);
  assert.match(source, /label === null/);
});

test("relabelling never clears a note and vice versa", () => {
  const source = read("src/lib/private-annotations.ts");
  assert.match(source, /SET note = CASE WHEN \? = 1 THEN \? ELSE note END/);
  assert.match(source, /label = CASE WHEN \? = 1 THEN \? ELSE label END/);
  assert.match(source, /EMPTY_UPDATE/);
});

test("passage anchoring is shared by deep links and restored annotations", () => {
  const anchor = read("src/lib/passage-anchor.ts");
  const hook = read("src/hooks/useSavedQuoteTarget.ts");
  assert.match(anchor, /export function findPassageRange/);
  assert.match(anchor, /export function rangeForOffsets/);
  assert.match(
    hook,
    /import \{ findPassageRange \} from "@\/lib\/passage-anchor"/,
  );
  // The hook must not keep a private copy that can drift from the shared one.
  assert.doesNotMatch(hook, /function findQuoteRange/);
  assert.doesNotMatch(hook, /function rangeForOffsets/);
});

test("a passage resolves only on exact text, never on a similar one", () => {
  const anchor = read("src/lib/passage-anchor.ts");
  // Context scoring only disambiguates repeated exact matches; it can never
  // promote a near-match, so a changed source yields null rather than the
  // wrong passage.
  assert.match(anchor, /text\.indexOf\(locator\.exactText\)/);
  assert.match(
    anchor,
    /return sectionMatch \? rangeForMatch\([\s\S]*?\) : null/,
  );
});
