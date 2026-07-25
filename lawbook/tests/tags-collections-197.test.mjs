/**
 * Issue #197 — private tags and collections.
 *
 * The promises that matter here live in SQL, not in TypeScript: case-insensitive
 * uniqueness per owner, owner-bound membership, and above all that deleting a tag
 * or collection removes memberships and never an authority or an annotation. Those
 * are executed against the real migrated schema.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  isOrganisationKind,
  normalizeDescription,
  normalizeGroupName,
} from "../src/lib/research-organisation-names.ts";

const MIGRATIONS = [
  "0004_saved_workspace.sql",
  "0007_expand_saved_authority_doc_types.sql",
  "0017_saved_quotes.sql",
  "0020_private_research_foundation.sql",
  "0021_annotation_labels.sql",
  "0022_document_notes.sql",
  "0023_tags_collections_follow_ups.sql",
];

const model = readFileSync("src/lib/research-organisation.ts", "utf8");
const listRoute = readFileSync("src/app/api/research-groups/route.ts", "utf8");
const itemRoute = readFileSync(
  "src/app/api/research-groups/[id]/route.ts",
  "utf8",
);
const membershipRoute = readFileSync(
  "src/app/api/research-groups/membership/route.ts",
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
      '','','my note','holding',10,10)`)
    .run();
  conn
    .prepare(
      "INSERT INTO research_tags (id,userId,name,createdAt,updatedAt) VALUES ('t1','owner','Negligence',1,1)",
    )
    .run();
  return conn;
}

test("the three ideas are distinguished in wording, not just in tables", () => {
  assert.match(model, /label\s+— what a \*passage\* means/);
  assert.match(model, /tag\s+— a topic or workflow across documents/);
  assert.match(model, /collection — a group of authorities for a matter/);
});

test("a name is trimmed and collapsed so one tag cannot become two", () => {
  assert.equal(normalizeGroupName("  Negligence  ", "tag"), "Negligence");
  assert.equal(normalizeGroupName("Exam   revision", "tag"), "Exam revision");
  assert.equal(normalizeGroupName("", "tag"), null);
  assert.equal(normalizeGroupName("   ", "tag"), null);
  assert.equal(normalizeGroupName(42, "tag"), null);
  assert.equal(normalizeGroupName("x".repeat(81), "tag"), null);
  // Collections allow longer names than tags.
  assert.equal(normalizeGroupName("x".repeat(81), "collection")?.length, 81);
  assert.equal(normalizeGroupName("x".repeat(121), "collection"), null);
});

test("a description is optional, trimmed, and length-bounded", () => {
  assert.equal(normalizeDescription(undefined), null);
  assert.equal(normalizeDescription(null), null);
  assert.equal(normalizeDescription("  notes  "), "notes");
  assert.equal(normalizeDescription(""), null);
  assert.equal(normalizeDescription(7), undefined, "wrong type is rejected");
  assert.equal(normalizeDescription("x".repeat(2001)), undefined);
});

test("only the two kinds are accepted", () => {
  assert.equal(isOrganisationKind("tag"), true);
  assert.equal(isOrganisationKind("collection"), true);
  assert.equal(isOrganisationKind("label"), false);
  assert.equal(isOrganisationKind(undefined), false);
});

test("names are unique per owner, case-insensitively, and not across owners", () => {
  const conn = db();
  const insert = conn.prepare(
    "INSERT INTO research_tags (id,userId,name,createdAt,updatedAt) VALUES (?,?,?,1,1)",
  );
  assert.throws(() => insert.run("t2", "owner", "negligence"), /UNIQUE/);
  assert.throws(() => insert.run("t3", "owner", "NEGLIGENCE"), /UNIQUE/);
  // A different owner may use the same name.
  assert.doesNotThrow(() => insert.run("t4", "other", "Negligence"));
});

test("deleting a tag removes memberships and keeps the document and its notes", () => {
  const conn = db();
  conn
    .prepare(
      "INSERT INTO research_tag_members (userId,tagId,authorityId,addedAt) VALUES ('owner','t1','auth1',1)",
    )
    .run();
  conn.prepare("DELETE FROM research_tags WHERE id='t1'").run();

  assert.equal(
    conn.prepare("SELECT COUNT(*) AS n FROM research_tag_members").get().n,
    0,
    "membership goes with the tag",
  );
  assert.equal(
    conn.prepare("SELECT COUNT(*) AS n FROM saved_authorities").get().n,
    1,
    "the authority must survive",
  );
  assert.equal(
    conn.prepare("SELECT COUNT(*) AS n FROM passage_annotations").get().n,
    1,
    "and every annotation on it",
  );
  assert.equal(
    conn.prepare("SELECT note FROM passage_annotations WHERE id='ann1'").get()
      .note,
    "my note",
  );
});

test("removing a document from the library removes its memberships only", () => {
  const conn = db();
  conn
    .prepare(
      "INSERT INTO research_tag_members (userId,tagId,authorityId,addedAt) VALUES ('owner','t1','auth1',1)",
    )
    .run();
  conn.prepare("DELETE FROM passage_annotations WHERE id='ann1'").run();
  conn
    .prepare(
      "DELETE FROM private_research_authority_guards WHERE userId='owner'",
    )
    .run();
  conn.prepare("DELETE FROM saved_authorities WHERE id='auth1'").run();
  assert.equal(
    conn.prepare("SELECT COUNT(*) AS n FROM research_tag_members").get().n,
    0,
  );
  assert.equal(
    conn.prepare("SELECT COUNT(*) AS n FROM research_tags").get().n,
    1,
    "the tag itself survives losing a member",
  );
});

test("membership cannot cross accounts even with a borrowed id", () => {
  const conn = db();
  // Another owner's tag id with this owner's authority.
  conn
    .prepare(
      "INSERT INTO research_tags (id,userId,name,createdAt,updatedAt) VALUES ('t-other','other','Theirs',1,1)",
    )
    .run();
  assert.throws(
    () =>
      conn
        .prepare(`INSERT INTO research_tag_members
        (userId,tagId,authorityId,addedAt) VALUES ('other','t-other','auth1',1)`)
        .run(),
    /FOREIGN KEY/,
    "another owner cannot attach their tag to this owner's authority",
  );
});

test("a document can hold many tags and belong to many collections", () => {
  const conn = db();
  conn
    .prepare(
      "INSERT INTO research_tags (id,userId,name,createdAt,updatedAt) VALUES ('t2','owner','Exam revision',1,1)",
    )
    .run();
  for (const tag of ["t1", "t2"]) {
    conn
      .prepare(
        "INSERT INTO research_tag_members (userId,tagId,authorityId,addedAt) VALUES ('owner',?,'auth1',1)",
      )
      .run(tag);
  }
  for (const [id, name] of [
    ["c1", "Tan v Lim matter"],
    ["c2", "Constitutional Law Week 4"],
  ]) {
    conn
      .prepare(
        "INSERT INTO research_collections (id,userId,name,createdAt,updatedAt) VALUES (?,'owner',?,1,1)",
      )
      .run(id, name);
    conn
      .prepare(
        "INSERT INTO research_collection_members (userId,collectionId,authorityId,addedAt) VALUES ('owner',?,'auth1',1)",
      )
      .run(id);
  }
  assert.equal(
    conn
      .prepare(
        "SELECT COUNT(*) AS n FROM research_tag_members WHERE authorityId='auth1'",
      )
      .get().n,
    2,
  );
  assert.equal(
    conn
      .prepare(
        "SELECT COUNT(*) AS n FROM research_collection_members WHERE authorityId='auth1'",
      )
      .get().n,
    2,
  );
  // The same pair twice is one membership, not two.
  assert.throws(
    () =>
      conn
        .prepare(
          "INSERT INTO research_tag_members (userId,tagId,authorityId,addedAt) VALUES ('owner','t1','auth1',2)",
        )
        .run(),
    /UNIQUE|PRIMARY KEY/,
  );
});

test("archiving is available so a delete is never the only option", () => {
  const conn = db();
  conn.prepare("UPDATE research_tags SET archivedAt=99 WHERE id='t1'").run();
  assert.equal(
    conn.prepare("SELECT archivedAt FROM research_tags WHERE id='t1'").get()
      .archivedAt,
    99,
  );
  assert.match(model, /archivedAt = \?/);
  assert.match(model, /archived rather than force-deleted/);
});

test("every statement in the data layer prepares against the real schema", () => {
  const conn = db();
  const failures = [];
  for (const match of model.matchAll(/\.prepare\(\s*`([\s\S]*?)`\s*[,)]/g)) {
    const sql = match[1]
      // Resolve the per-kind template interpolations both ways.
      .replace(/\$\{config\.table\}/g, "research_tags")
      .replace(/\$\{config\.members\}/g, "research_tag_members")
      .replace(/\$\{config\.memberKey\}/g, "tagId")
      .replace(/\$\{description\}/g, "NULL")
      .replace(/\$\{columns\}/g, "(id, userId, name, createdAt, updatedAt)")
      .replace(/\$\{values\}/g, "(?, ?, ?, ?, ?)")
      .replace(/\$\{sets\.join\(", "\)\}/g, "updatedAt = ?, name = ?");
    if (sql.includes("${")) continue;
    try {
      conn.prepare(sql);
    } catch (error) {
      failures.push(`${sql.trim().split("\n")[0]} -> ${error.message}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("the routes are private, authenticated and honest", () => {
  for (const route of [listRoute, itemRoute, membershipRoute]) {
    assert.match(route, /Authentication required/);
    assert.match(route, /privateRoute/);
    assert.match(route, /export const dynamic = "force-dynamic"/);
    assert.match(route, /Invalid kind/);
  }
  // Creating an existing name joins it rather than erroring.
  assert.match(listRoute, /joins it rather than failing/);
  // A duplicate rename is a clear conflict, not a silent no-op.
  assert.match(itemRoute, /You already have one with that name/);
  assert.match(itemRoute, /status: 409/);
  // Deletion states what it kept.
  assert.match(itemRoute, /keptDocuments: true/);
  assert.match(itemRoute, /keptAnnotations: true/);
  assert.match(itemRoute, /mergeInto/);
  // No sharing or visibility selector is introduced by this issue.
  for (const route of [listRoute, itemRoute, membershipRoute]) {
    assert.doesNotMatch(route, /share|public|visibility/i);
  }
});
