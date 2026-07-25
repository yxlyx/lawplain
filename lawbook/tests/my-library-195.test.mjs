/**
 * Issue #195 — My Library.
 *
 * The library query has nine composable filters, three sort orders and keyset
 * pagination that must compare the same expression it orders by. Source
 * assertions cannot see any of that going wrong, so these tests execute the real
 * statement from `buildLibraryQuery` against the real migrated schema with real
 * rows.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { buildLibraryQuery, toLibraryPage } from "../src/lib/library-query.ts";

const MIGRATIONS = [
  "0004_saved_workspace.sql",
  "0007_expand_saved_authority_doc_types.sql",
  "0017_saved_quotes.sql",
  "0020_private_research_foundation.sql",
  "0021_annotation_labels.sql",
  "0022_document_notes.sql",
  "0023_tags_collections_follow_ups.sql",
];

function db() {
  const conn = new DatabaseSync(":memory:");
  conn.exec("PRAGMA foreign_keys=ON; CREATE TABLE user (id TEXT PRIMARY KEY)");
  for (const name of MIGRATIONS)
    conn.exec(readFileSync(`migrations/${name}`, "utf8"));
  for (const id of ["owner", "other"])
    conn.prepare("INSERT INTO user VALUES (?)").run(id);
  return conn;
}

let seq = 0;
function authority(
  conn,
  {
    id,
    userId = "owner",
    docType = "judgment",
    docId,
    savedAt = null,
    activityAt = 100,
  },
) {
  conn
    .prepare(`INSERT INTO saved_authorities
    (id,userId,docType,docId,title,path,createdAt,updatedAt,citation,savedAt,activityAt)
    VALUES (?,?,?,?,?,?,50,50,?,?,?)`)
    .run(
      id,
      userId,
      docType,
      docId ?? id,
      `Title ${id}`,
      `/${docType}/${docId ?? id}`,
      `Cite ${id}`,
      savedAt,
      activityAt,
    );
}

function annotation(
  conn,
  {
    id,
    userId = "owner",
    authorityId,
    label = "key-point",
    note = null,
    updatedAt = 100,
    deletedAt = null,
  },
) {
  seq += 1;
  conn
    .prepare(`INSERT INTO passage_annotations
    (id,userId,authorityId,title,citation,path,exactText,anchor,startOffset,
     endOffset,contextBefore,contextAfter,note,label,createdAt,updatedAt,deletedAt)
    VALUES (?,?,?,'T','C','/judgment/d',?,?,0,4,'','',?,?,50,?,?)`)
    .run(
      id,
      userId,
      authorityId,
      `txt${seq}`,
      `p${seq}`,
      note,
      label,
      updatedAt,
      deletedAt,
    );
}

function run(conn, userId, options) {
  const built = buildLibraryQuery(userId, options);
  const rows = conn.prepare(built.sql).all(...built.params);
  return toLibraryPage(rows, {
    limit: built.limit,
    sort: built.sort,
    shape: built.shape,
    userId,
  });
}

const ids = (page) => page.authorities.map((a) => a.id);

test("the library statement is valid against the real schema", () => {
  const conn = db();
  for (const options of [
    {},
    { docType: "statute" },
    { label: "holding" },
    { hasPassageNotes: true },
    { hasDocumentNote: true },
    { hasOpenFollowUps: true },
    { tagId: "t1" },
    { collectionId: "c1" },
    { savedFrom: 1, savedTo: 2 },
    { sort: "saved" },
    { sort: "title" },
    { includePreview: true },
  ]) {
    assert.doesNotThrow(
      () => run(conn, "owner", options),
      `invalid SQL for ${JSON.stringify(options)}`,
    );
  }
});

test("an explicitly saved authority with no annotations stays visible", () => {
  const conn = db();
  authority(conn, { id: "plain", savedAt: 90 });
  const page = run(conn, "owner");
  assert.deepEqual(ids(page), ["plain"]);
  assert.equal(page.authorities[0].annotationCount, 0);
  assert.deepEqual(page.authorities[0].labels, []);
});

test("a first annotation or note joins the library without a second card", () => {
  const conn = db();
  authority(conn, { id: "a1", savedAt: null });
  annotation(conn, { id: "n1", authorityId: "a1" });
  conn
    .prepare(`INSERT INTO document_notes
    (id,userId,authorityId,title,citation,path,body,template,createdAt,updatedAt)
    VALUES ('d1','owner','a1','T','C','/judgment/a1','my note','free',60,60)`)
    .run();
  const page = run(conn, "owner");
  assert.equal(page.authorities.length, 1, "one card per document");
  assert.equal(page.authorities[0].annotationCount, 1);
  assert.equal(page.authorities[0].documentNoteCount, 1);
});

test("counts and labels are accurate and exclude deleted annotations", () => {
  const conn = db();
  authority(conn, { id: "a1", savedAt: 90 });
  annotation(conn, {
    id: "n1",
    authorityId: "a1",
    label: "holding",
    note: "why",
  });
  annotation(conn, { id: "n2", authorityId: "a1", label: "issue" });
  annotation(conn, {
    id: "n3",
    authorityId: "a1",
    label: "facts",
    deletedAt: 120,
  });
  const card = run(conn, "owner").authorities[0];
  assert.equal(
    card.annotationCount,
    2,
    "deleted annotation must not be counted",
  );
  assert.equal(card.passageNoteCount, 1);
  assert.deepEqual(card.labels.sort(), ["holding", "issue"]);
});

test("another account's research is never visible", () => {
  const conn = db();
  authority(conn, { id: "mine", savedAt: 90 });
  authority(conn, { id: "theirs", userId: "other", savedAt: 95 });
  assert.deepEqual(ids(run(conn, "owner")), ["mine"]);
  assert.deepEqual(ids(run(conn, "other")), ["theirs"]);
});

test("filters compose, and each narrows the set", () => {
  const conn = db();
  authority(conn, { id: "j-note", docType: "judgment", savedAt: 90 });
  annotation(conn, {
    id: "n1",
    authorityId: "j-note",
    label: "holding",
    note: "n",
  });
  authority(conn, { id: "j-bare", docType: "judgment", savedAt: 91 });
  annotation(conn, { id: "n2", authorityId: "j-bare", label: "holding" });
  authority(conn, { id: "s-note", docType: "statute", savedAt: 92 });
  annotation(conn, {
    id: "n3",
    authorityId: "s-note",
    label: "issue",
    note: "n",
  });

  assert.equal(ids(run(conn, "owner")).length, 3);
  assert.deepEqual(ids(run(conn, "owner", { docType: "statute" })), ["s-note"]);
  assert.deepEqual(ids(run(conn, "owner", { label: "holding" })).sort(), [
    "j-bare",
    "j-note",
  ]);
  // Composed: judgment AND has a passage note AND labelled holding.
  assert.deepEqual(
    ids(
      run(conn, "owner", {
        docType: "judgment",
        hasPassageNotes: true,
        label: "holding",
      }),
    ),
    ["j-note"],
  );
  // A filter combination with no members is empty, not an error.
  assert.deepEqual(
    ids(run(conn, "owner", { docType: "statute", label: "holding" })),
    [],
  );
});

test("sorting by activity does not overwrite or reorder the saved date", () => {
  const conn = db();
  authority(conn, { id: "old-save", savedAt: 10, activityAt: 900 });
  authority(conn, { id: "new-save", savedAt: 800, activityAt: 20 });

  const byActivity = run(conn, "owner", { sort: "activity" });
  assert.deepEqual(ids(byActivity), ["old-save", "new-save"]);
  const bySaved = run(conn, "owner", { sort: "saved" });
  assert.deepEqual(ids(bySaved), ["new-save", "old-save"]);

  // The stored savedAt is untouched by either ordering.
  assert.equal(
    conn
      .prepare("SELECT savedAt FROM saved_authorities WHERE id='old-save'")
      .get().savedAt,
    10,
  );
  const card = byActivity.authorities.find((a) => a.id === "old-save");
  assert.equal(card.savedAt, 10, "the card reports the original saved date");
  assert.equal(card.activityAt, 900, "and last activity separately");
});

test("a note preview is only produced when the reader asks for one", () => {
  const conn = db();
  authority(conn, { id: "a1", savedAt: 90 });
  conn
    .prepare(`INSERT INTO document_notes
    (id,userId,authorityId,title,citation,path,body,template,createdAt,updatedAt)
    VALUES ('d1','owner','a1','T','C','/judgment/a1','secret thoughts','free',60,60)`)
    .run();

  const hidden = run(conn, "owner", { includePreview: false });
  assert.equal(hidden.authorities[0].notePreview, null);
  // Hiding must stop the text being selected at all, not merely unrendered.
  assert.ok(
    !buildLibraryQuery("owner", { includePreview: false }).sql.includes(
      "n.body",
    ),
    "the hidden query must not select note text",
  );

  const shown = run(conn, "owner", { includePreview: true });
  assert.equal(shown.authorities[0].notePreview, "secret thoughts");
});

test("a long preview is bounded rather than shipping the whole note", () => {
  const conn = db();
  authority(conn, { id: "a1", savedAt: 90 });
  const long = "x".repeat(600);
  conn
    .prepare(`INSERT INTO document_notes
    (id,userId,authorityId,title,citation,path,body,template,createdAt,updatedAt)
    VALUES ('d1','owner','a1','T','C','/judgment/a1',?,'free',60,60)`)
    .run(long);
  const preview = run(conn, "owner", { includePreview: true }).authorities[0]
    .notePreview;
  assert.ok(preview.length < 200, `preview was ${preview.length} chars`);
  assert.ok(preview.endsWith("…"));
});

test("pagination is stable and a cursor cannot escape its filter set", () => {
  const conn = db();
  for (let i = 0; i < 5; i += 1) {
    authority(conn, { id: `a${i}`, savedAt: 90, activityAt: 100 + i });
  }
  const first = run(conn, "owner", { limit: 2 });
  assert.deepEqual(ids(first), ["a4", "a3"]);
  assert.ok(first.nextCursor);
  const second = run(conn, "owner", { limit: 2, cursor: first.nextCursor });
  assert.deepEqual(ids(second), ["a2", "a1"]);

  // A cursor minted under one filter set is rejected by another, so it cannot be
  // replayed to page past a filter.
  assert.throws(
    () =>
      run(conn, "owner", {
        limit: 2,
        cursor: first.nextCursor,
        docType: "statute",
      }),
    /INVALID_CURSOR/,
  );
  // Nor can another account use it.
  assert.throws(
    () => run(conn, "other", { limit: 2, cursor: first.nextCursor }),
    /INVALID_CURSOR/,
  );
});

test("tags, collections and open follow-ups reach the card", () => {
  const conn = db();
  authority(conn, { id: "a1", savedAt: 90 });
  annotation(conn, { id: "n1", authorityId: "a1", label: "follow-up" });
  conn
    .prepare(
      "INSERT INTO research_tags (id,userId,name,createdAt,updatedAt) VALUES ('t1','owner','Negligence',1,1)",
    )
    .run();
  conn
    .prepare(
      "INSERT INTO research_tag_members (userId,tagId,authorityId,addedAt) VALUES ('owner','t1','a1',1)",
    )
    .run();
  conn
    .prepare(
      "INSERT INTO research_collections (id,userId,name,createdAt,updatedAt) VALUES ('c1','owner','Tan v Lim',1,1)",
    )
    .run();
  conn
    .prepare(
      "INSERT INTO research_collection_members (userId,collectionId,authorityId,addedAt) VALUES ('owner','c1','a1',1)",
    )
    .run();
  conn
    .prepare(
      "INSERT INTO annotation_follow_ups (userId,annotationId,createdAt,updatedAt) VALUES ('owner','n1',1,1)",
    )
    .run();

  const card = run(conn, "owner").authorities[0];
  assert.deepEqual(card.tags, ["Negligence"]);
  assert.deepEqual(card.collections, ["Tan v Lim"]);
  assert.equal(card.openFollowUpCount, 1);

  assert.deepEqual(ids(run(conn, "owner", { tagId: "t1" })), ["a1"]);
  assert.deepEqual(ids(run(conn, "owner", { collectionId: "c1" })), ["a1"]);
  assert.deepEqual(ids(run(conn, "owner", { hasOpenFollowUps: true })), ["a1"]);
  assert.deepEqual(ids(run(conn, "owner", { tagId: "nope" })), []);

  // Resolving the follow-up clears the count and the filter.
  conn
    .prepare(
      "UPDATE annotation_follow_ups SET resolvedAt=5 WHERE userId='owner' AND annotationId='n1'",
    )
    .run();
  assert.equal(run(conn, "owner").authorities[0].openFollowUpCount, 0);
  assert.deepEqual(ids(run(conn, "owner", { hasOpenFollowUps: true })), []);
});

test("the library route validates filters instead of returning an empty page", () => {
  const route = readFileSync("src/app/api/library/route.ts", "utf8");
  assert.match(route, /Invalid document type/);
  assert.match(route, /Invalid label/);
  assert.match(route, /Invalid sort/);
  assert.match(route, /Invalid date range/);
  assert.match(route, /Invalid cursor/);
  assert.match(route, /Authentication required/);
  assert.match(route, /privateJson/);
  assert.match(route, /export const dynamic = "force-dynamic"/);
});
