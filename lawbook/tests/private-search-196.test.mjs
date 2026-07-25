/**
 * Issue #196 — search a reader's own private research.
 *
 * A three-branch union with owner scoping in every branch, LIKE escaping, and
 * per-field match reporting. All executed against the real migrated schema: the
 * one thing that must never happen here is a hit from another account, and source
 * assertions cannot rule that out.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  buildPrivateSearchQuery,
  likePattern,
  normalizeSearchQuery,
  snippet,
  toPrivateSearchPage,
} from "../src/lib/private-search-query.ts";

const MIGRATIONS = [
  "0004_saved_workspace.sql",
  "0007_expand_saved_authority_doc_types.sql",
  "0017_saved_quotes.sql",
  "0020_private_research_foundation.sql",
  "0021_annotation_labels.sql",
  "0022_document_notes.sql",
  "0023_tags_collections_follow_ups.sql",
];

const route = readFileSync("src/app/api/research-search/route.ts", "utf8");
const model = readFileSync("src/lib/private-search-query.ts", "utf8");

function db() {
  const conn = new DatabaseSync(":memory:");
  conn.exec("PRAGMA foreign_keys=ON; CREATE TABLE user (id TEXT PRIMARY KEY)");
  for (const name of MIGRATIONS)
    conn.exec(readFileSync(`migrations/${name}`, "utf8"));
  for (const id of ["owner", "other"])
    conn.prepare("INSERT INTO user VALUES (?)").run(id);
  return conn;
}

function authority(
  conn,
  id,
  userId = "owner",
  title = "Duty of care case",
  docType = "judgment",
) {
  conn
    .prepare(`INSERT INTO saved_authorities
    (id,userId,docType,docId,title,path,createdAt,updatedAt,citation,savedAt,activityAt)
    VALUES (?,?,?,?,?,?,10,10,?,10,100)`)
    .run(
      id,
      userId,
      docType,
      id,
      title,
      `/${docType}/${id}`,
      `[2024] SGCA ${id}`,
    );
}

let n = 0;
function annotation(
  conn,
  {
    id,
    userId = "owner",
    authorityId,
    exactText,
    note = null,
    label = "holding",
  },
) {
  n += 1;
  conn
    .prepare(`INSERT INTO passage_annotations
    (id,userId,authorityId,title,citation,path,exactText,anchor,startOffset,
     endOffset,contextBefore,contextAfter,note,label,createdAt,updatedAt)
    VALUES (?,?,?,'T','C','/judgment/d',?,?,0,?,'','',?,?,10,100)`)
    .run(
      id,
      userId,
      authorityId,
      exactText,
      `p${n}`,
      exactText.length,
      note,
      label,
    );
}

function run(conn, userId, options) {
  const built = buildPrivateSearchQuery(userId, options);
  const rows = conn.prepare(built.sql).all(...built.params);
  return toPrivateSearchPage(rows, {
    limit: built.limit,
    shape: built.shape,
    userId,
    q: options.q,
  });
}

test("a query is trimmed, collapsed and bounded", () => {
  assert.equal(normalizeSearchQuery("  duty   of care "), "duty of care");
  assert.equal(normalizeSearchQuery(""), null);
  assert.equal(normalizeSearchQuery("   "), null);
  assert.equal(normalizeSearchQuery(null), null);
  assert.equal(normalizeSearchQuery("x".repeat(201)), null);
});

test("LIKE wildcards in a query are searched for, not honoured", () => {
  assert.equal(likePattern("100%"), "%100\\%%");
  assert.equal(likePattern("a_b"), "%a\\_b%");
  assert.equal(likePattern("back\\slash"), "%back\\\\slash%");
  // Executed: a query of "%" must not match everything.
  const conn = db();
  authority(conn, "a1");
  annotation(conn, { id: "n1", authorityId: "a1", exactText: "duty of care" });
  assert.equal(run(conn, "owner", { q: "%" }).results.length, 0);
  // The same word does match for real — here in the passage and the title.
  assert.equal(run(conn, "owner", { q: "duty" }).results.length, 2);
});

test("the search statement is valid for every filter combination", () => {
  const conn = db();
  for (const options of [
    { q: "x" },
    { q: "x", docType: "statute" },
    { q: "x", label: "holding" },
    { q: "x", tagId: "t1" },
    { q: "x", collectionId: "c1" },
    {
      q: "x",
      docType: "judgment",
      label: "issue",
      tagId: "t1",
      collectionId: "c1",
    },
  ]) {
    assert.doesNotThrow(
      () => run(conn, "owner", options),
      `invalid SQL for ${JSON.stringify(options)}`,
    );
  }
});

test("another account's research is never returned", () => {
  const conn = db();
  authority(conn, "mine", "owner", "Negligence and duty");
  annotation(conn, {
    id: "n1",
    authorityId: "mine",
    exactText: "the duty of care arises",
    note: "my private thought",
  });
  authority(conn, "theirs", "other", "Negligence and duty");
  annotation(conn, {
    id: "n2",
    userId: "other",
    authorityId: "theirs",
    exactText: "the duty of care arises",
    note: "their private thought",
  });
  conn
    .prepare(`INSERT INTO document_notes
    (id,userId,authorityId,title,citation,path,body,template,createdAt,updatedAt)
    VALUES ('d2','other','theirs','T','C','/judgment/theirs','their duty note','free',10,100)`)
    .run();

  const mine = run(conn, "owner", { q: "duty" });
  assert.ok(mine.results.length > 0);
  for (const hit of mine.results) {
    assert.ok(
      hit.authorityId === "mine",
      `leaked ${hit.authorityId} into owner's results`,
    );
    assert.ok(!(hit.noteText ?? "").includes("their"));
  }
  // And the reverse.
  for (const hit of run(conn, "other", { q: "duty" }).results)
    assert.equal(hit.authorityId, "theirs");
});

test("a result says why it matched, and which text was whose", () => {
  const conn = db();
  authority(conn, "a1", "owner", "Duty of care case");
  annotation(conn, {
    id: "n1",
    authorityId: "a1",
    exactText: "a duty of care is owed to one's neighbour",
    note: "compare with the Scots authority",
  });
  conn
    .prepare(`INSERT INTO document_notes
    (id,userId,authorityId,title,citation,path,body,template,createdAt,updatedAt)
    VALUES ('d1','owner','a1','T','C','/judgment/a1','my summary of duty','free',10,90)`)
    .run();

  const byPassage = run(conn, "owner", { q: "neighbour" }).results;
  assert.equal(byPassage.length, 1);
  assert.deepEqual(byPassage[0].matchedIn, ["passage"]);
  assert.match(byPassage[0].sourceText, /neighbour/);
  // The reader's own words arrive in a different field from the source text.
  assert.equal(byPassage[0].noteText, "compare with the Scots authority");

  const byNote = run(conn, "owner", { q: "Scots" }).results;
  assert.deepEqual(byNote[0].matchedIn, ["passageNote"]);

  const kinds = run(conn, "owner", { q: "duty" }).results.map((r) => r.kind);
  assert.ok(kinds.includes("annotation"));
  assert.ok(kinds.includes("documentNote"));
  assert.ok(kinds.includes("document"), "a title match should surface too");

  const docNote = run(conn, "owner", { q: "summary" }).results[0];
  assert.deepEqual(docNote.matchedIn, ["documentNote"]);
  assert.equal(docNote.sourceText, null, "a document note has no source text");
  assert.match(docNote.noteText, /my summary/);
});

test("a passage result carries the deep link back to its annotation", () => {
  const conn = db();
  authority(conn, "a1");
  annotation(conn, {
    id: "n1",
    authorityId: "a1",
    exactText: "unique phrase here",
  });
  const hit = run(conn, "owner", { q: "unique phrase" }).results[0];
  assert.equal(hit.annotationId, "n1");
  assert.match(hit.path, /^\/judgment\//);
  assert.equal(hit.label, "holding");
});

test("filters narrow the search, and a label filter is about passages", () => {
  const conn = db();
  authority(conn, "j1", "owner", "Judgment on duty", "judgment");
  annotation(conn, {
    id: "n1",
    authorityId: "j1",
    exactText: "duty holding",
    label: "holding",
  });
  authority(conn, "s1", "owner", "Statute on duty", "statute");
  annotation(conn, {
    id: "n2",
    authorityId: "s1",
    exactText: "duty issue",
    label: "issue",
  });

  assert.equal(run(conn, "owner", { q: "duty" }).results.length, 4);
  assert.ok(
    run(conn, "owner", { q: "duty", docType: "statute" }).results.every(
      (r) => r.docType === "statute",
    ),
  );
  // A label describes a passage, so filtering by one returns passage hits only
  // rather than silently ignoring the filter on documents and document notes.
  const labelled = run(conn, "owner", { q: "duty", label: "holding" }).results;
  assert.equal(labelled.length, 1);
  assert.equal(labelled[0].annotationId, "n1");
});

test("a deleted annotation is not searchable", () => {
  const conn = db();
  authority(conn, "a1");
  annotation(conn, { id: "n1", authorityId: "a1", exactText: "findable text" });
  assert.equal(run(conn, "owner", { q: "findable" }).results.length, 1);
  conn
    .prepare("UPDATE passage_annotations SET deletedAt=500 WHERE id='n1'")
    .run();
  assert.equal(run(conn, "owner", { q: "findable" }).results.length, 0);
});

test("search is case-insensitive and matches inside words", () => {
  const conn = db();
  authority(conn, "a1", "owner", "Contract Formation");
  annotation(conn, {
    id: "n1",
    authorityId: "a1",
    exactText: "The Consideration must move from the promisee",
  });
  assert.ok(run(conn, "owner", { q: "consideration" }).results.length > 0);
  assert.ok(run(conn, "owner", { q: "CONSIDERATION" }).results.length > 0);
  assert.ok(run(conn, "owner", { q: "sideration" }).results.length > 0);
});

test("a snippet shows the match rather than the start of a long note", () => {
  const long = `${"filler ".repeat(60)}the needle is here${" more".repeat(60)}`;
  const shown = snippet(long, "needle");
  assert.match(shown, /needle/);
  assert.ok(shown.length <= 200, `snippet was ${shown.length}`);
  assert.ok(shown.startsWith("…"), "a mid-text match is elided at the front");
  assert.equal(snippet(null, "x"), null);
  assert.equal(snippet("   ", "x"), null);
});

test("a cursor is bound to its owner and its filter set", () => {
  const conn = db();
  for (let i = 0; i < 4; i += 1) {
    authority(conn, `a${i}`);
    annotation(conn, {
      id: `n${i}`,
      authorityId: `a${i}`,
      exactText: "duty text",
    });
  }
  const first = run(conn, "owner", { q: "duty text", limit: 2 });
  assert.equal(first.results.length, 2);
  assert.ok(first.nextCursor);
  assert.doesNotThrow(() =>
    run(conn, "owner", { q: "duty text", limit: 2, cursor: first.nextCursor }),
  );
  assert.throws(
    () =>
      run(conn, "other", {
        q: "duty text",
        limit: 2,
        cursor: first.nextCursor,
      }),
    /INVALID_CURSOR/,
    "another account cannot page with this cursor",
  );
  assert.throws(
    () =>
      run(conn, "owner", {
        q: "duty text",
        limit: 2,
        cursor: first.nextCursor,
        docType: "statute",
      }),
    /INVALID_CURSOR/,
    "a cursor cannot be replayed against a different filter set",
  );
});

test("an empty result set is a normal answer, not an error", () => {
  const conn = db();
  authority(conn, "a1");
  const page = run(conn, "owner", { q: "nothing like this exists" });
  assert.deepEqual(page.results, []);
  assert.equal(page.nextCursor, null);
});

test("private queries and note text stay out of logs and analytics", () => {
  assert.match(route, /never reaches analytics/);
  assert.match(route, /privateRoute/);
  assert.match(route, /Authentication required/);
  assert.match(route, /export const dynamic = "force-dynamic"/);
  // No console or analytics *call* may see the query. Comments are stripped
  // first, since the route explains this policy in prose.
  const code = (source) => source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code(route), /console\.|analytics|track\(/i);
  assert.doesNotMatch(code(model), /console\.|analytics/i);
  // The choice not to mirror note text into an FTS table is recorded.
  assert.match(model, /more copies of the most sensitive data/);
});
