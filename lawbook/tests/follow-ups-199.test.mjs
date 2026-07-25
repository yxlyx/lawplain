/**
 * Issue #199 — private follow-up workflow.
 *
 * The claim worth executing rather than asserting from source is that follow-up
 * state survives anything done to the label: #199 asks for follow-up to be more
 * than a colour, and the way to prove it is to rename and recolour the label and
 * watch the state stay put.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  isOverdue,
  normalizeDueAt,
  normalizeFollowUpNote,
} from "../src/lib/follow-up-rules.ts";

const MIGRATIONS = [
  "0004_saved_workspace.sql",
  "0007_expand_saved_authority_doc_types.sql",
  "0017_saved_quotes.sql",
  "0020_private_research_foundation.sql",
  "0021_annotation_labels.sql",
  "0022_document_notes.sql",
  "0023_tags_collections_follow_ups.sql",
];

const model = readFileSync("src/lib/follow-ups.ts", "utf8");
const route = readFileSync("src/app/api/follow-ups/route.ts", "utf8");
const migration = readFileSync(
  "migrations/0023_tags_collections_follow_ups.sql",
  "utf8",
);

function db() {
  const conn = new DatabaseSync(":memory:");
  conn.exec("PRAGMA foreign_keys=ON; CREATE TABLE user (id TEXT PRIMARY KEY)");
  for (const name of MIGRATIONS)
    conn.exec(readFileSync(`migrations/${name}`, "utf8"));
  for (const id of ["owner", "other"])
    conn.prepare("INSERT INTO user VALUES (?)").run(id);
  conn
    .prepare(`INSERT INTO saved_authorities
    (id,userId,docType,docId,title,path,createdAt,updatedAt,citation,savedAt,activityAt)
    VALUES ('auth1','owner','judgment','doc','T','/judgment/doc',10,10,'C',10,10)`)
    .run();
  conn
    .prepare(`INSERT INTO passage_annotations
    (id,userId,authorityId,title,citation,path,exactText,anchor,startOffset,
     endOffset,contextBefore,contextAfter,note,label,createdAt,updatedAt)
    VALUES ('ann1','owner','auth1','T','C','/judgment/doc#p','text','p',0,4,
      '','',NULL,'follow-up',10,10)`)
    .run();
  conn
    .prepare(`INSERT INTO annotation_follow_ups
    (userId,annotationId,note,dueAt,createdAt,updatedAt)
    VALUES ('owner','ann1','check this citation',5000,10,10)`)
    .run();
  return conn;
}

test("follow-up state is keyed on the annotation, not on its label", () => {
  assert.match(migration, /CREATE TABLE annotation_follow_ups/);
  assert.match(migration, /PRIMARY KEY \(userId, annotationId\)/);
  // The table has no label column at all, which is the structural reason the
  // state cannot be lost by editing a label.
  const columns = migration
    .replace(/--[^\n]*/g, "")
    .match(/CREATE TABLE annotation_follow_ups \(([\s\S]*?)\n\);/)[1];
  assert.ok(!/label/i.test(columns), "follow-up must not reference a label");
  assert.match(model, /never on\n \* the annotation's label/);
});

test("renaming or recolouring the label does not lose the follow-up", () => {
  const conn = db();
  // Whatever happens to the label — renamed to a user-defined id, or replaced by
  // one this release does not know — the follow-up is still open and still holds
  // its note and due date.
  for (const label of ["chase-up", "renamed-follow-up", "zzz-unknown"]) {
    conn
      .prepare("UPDATE passage_annotations SET label=? WHERE id='ann1'")
      .run(label);
    const row = conn
      .prepare(
        "SELECT note, dueAt, resolvedAt FROM annotation_follow_ups WHERE annotationId='ann1'",
      )
      .get();
    assert.equal(row.note, "check this citation");
    assert.equal(row.dueAt, 5000);
    assert.equal(
      row.resolvedAt,
      null,
      `state lost after label became ${label}`,
    );
  }
});

test("resolving and reopening are both possible and neither deletes anything", () => {
  const conn = db();
  conn
    .prepare(
      "UPDATE annotation_follow_ups SET resolvedAt=900 WHERE annotationId='ann1'",
    )
    .run();
  assert.equal(
    conn
      .prepare(
        "SELECT resolvedAt FROM annotation_follow_ups WHERE annotationId='ann1'",
      )
      .get().resolvedAt,
    900,
  );
  // Resolved items remain discoverable rather than being removed.
  assert.equal(
    conn.prepare("SELECT COUNT(*) AS n FROM annotation_follow_ups").get().n,
    1,
  );
  conn
    .prepare(
      "UPDATE annotation_follow_ups SET resolvedAt=NULL WHERE annotationId='ann1'",
    )
    .run();
  assert.equal(
    conn
      .prepare(
        "SELECT resolvedAt FROM annotation_follow_ups WHERE annotationId='ann1'",
      )
      .get().resolvedAt,
    null,
  );
});

test("deleting the annotation takes its follow-up, but not the reverse", () => {
  const conn = db();
  conn
    .prepare("DELETE FROM annotation_follow_ups WHERE annotationId='ann1'")
    .run();
  assert.equal(
    conn.prepare("SELECT COUNT(*) AS n FROM passage_annotations").get().n,
    1,
    "removing a follow-up must keep the highlight",
  );
  conn
    .prepare(`INSERT INTO annotation_follow_ups
    (userId,annotationId,createdAt,updatedAt) VALUES ('owner','ann1',1,1)`)
    .run();
  conn.prepare("DELETE FROM passage_annotations WHERE id='ann1'").run();
  assert.equal(
    conn.prepare("SELECT COUNT(*) AS n FROM annotation_follow_ups").get().n,
    0,
    "deleting the highlight must not orphan a follow-up",
  );
});

test("a follow-up cannot be attached to another account's annotation", () => {
  const conn = db();
  assert.throws(
    () =>
      conn
        .prepare(`INSERT INTO annotation_follow_ups
        (userId,annotationId,createdAt,updatedAt) VALUES ('other','ann1',1,1)`)
        .run(),
    /FOREIGN KEY/,
  );
});

test("a note is optional, trimmed and bounded", () => {
  assert.equal(normalizeFollowUpNote(null), null);
  assert.equal(normalizeFollowUpNote("  chase  "), "chase");
  assert.equal(normalizeFollowUpNote(""), null);
  assert.equal(normalizeFollowUpNote(5), undefined);
  assert.equal(normalizeFollowUpNote("x".repeat(2001)), undefined);
});

test("a due date is an instant, so overdue cannot flip with a timezone", () => {
  // A bare calendar date means the end of that day UTC, so something due today
  // does not read as overdue all day.
  const due = normalizeDueAt("2026-07-25");
  assert.equal(due, Date.UTC(2026, 6, 25, 23, 59, 59, 999));
  assert.equal(isOverdue(due, null, Date.UTC(2026, 6, 25, 12, 0, 0)), false);
  assert.equal(isOverdue(due, null, Date.UTC(2026, 6, 26, 0, 0, 1)), true);

  assert.equal(normalizeDueAt(null), null);
  assert.equal(normalizeDueAt(""), null);
  assert.equal(normalizeDueAt("not a date"), undefined);
  assert.equal(normalizeDueAt(-1), undefined);
  assert.equal(normalizeDueAt(1735689600000), 1735689600000);
});

test("a resolved follow-up is never overdue, however old its date", () => {
  assert.equal(isOverdue(1, 999, 1_000_000), false);
  assert.equal(isOverdue(1, null, 1_000_000), true);
  assert.equal(isOverdue(null, null, 1_000_000), false);
});

test("every statement in the data layer prepares against the real schema", () => {
  const conn = db();
  const failures = [];
  const select = model.match(/const SELECT_ITEM = `([\s\S]*?)`;/)[1];
  for (const match of model.matchAll(/\.prepare\(\s*`([\s\S]*?)`\s*\)/g)) {
    const sql = match[1].replace(/\$\{SELECT_ITEM\}/g, select);
    if (sql.includes("${")) continue;
    try {
      conn.prepare(sql);
    } catch (error) {
      failures.push(`${sql.trim().split("\n")[0]} -> ${error.message}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("open items lead, undated sort last, and resolved stay reachable", () => {
  assert.match(
    model,
    /ORDER BY f\.resolvedAt IS NOT NULL, f\.dueAt IS NULL, f\.dueAt ASC/,
  );
  assert.match(model, /Default lists open items only; resolved stay reachable/);
  assert.match(route, /Invalid state/);
});

test("the follow-up route is private, authenticated and honest", () => {
  assert.match(route, /Authentication required/);
  assert.match(route, /privateRoute/);
  assert.match(route, /export const dynamic = "force-dynamic"/);
  assert.match(route, /That passage is not in your research/);
  assert.match(route, /No follow-up to remove/);
  assert.match(route, /keptAnnotation: true/);
  // MVP has no email or push notification, so no note text can leak to one.
  assert.doesNotMatch(route, /email|push|notif/i);
});
