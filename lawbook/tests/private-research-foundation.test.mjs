import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const privateRoutes = [
  "src/app/api/annotations/route.ts",
  "src/app/api/annotations/[id]/route.ts",
  "src/app/api/library/route.ts",
  "src/app/api/quotes/route.ts",
  "src/app/api/quotes/[id]/route.ts",
  "src/app/api/saved/route.ts",
];

function migratedDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE user (id TEXT PRIMARY KEY)");
  for (const migration of [
    "0004_saved_workspace.sql",
    "0007_expand_saved_authority_doc_types.sql",
    "0017_saved_quotes.sql",
  ])
    db.exec(read(`migrations/${migration}`));
  db.prepare("INSERT INTO user VALUES (?)").run("owner");
  db.prepare("INSERT INTO user VALUES (?)").run("other");
  return db;
}

test("migration preserves quote IDs and immutable source snapshots", () => {
  const db = migratedDb();
  db.prepare(`INSERT INTO saved_authorities
    (id,userId,docType,docId,title,path,createdAt,updatedAt)
    VALUES ('saved','owner','judgment','doc','Title','/judgment/doc',10,20)`).run();
  db.prepare(`INSERT INTO saved_quotes VALUES
    ('active','owner','judgment','doc','text','Captured title','[2024] 1',
     '/judgment/doc#p1','p1',0,4,'before','after',30,NULL),
    ('second','owner','judgment','doc','other','Earlier title','[2023] 2',
     '/judgment/doc#p2','p2',0,5,'before 2','after 2',31,NULL),
    ('quote-only','owner','statute','act','section','Act','Cap 1',
     '/statute/act#s2','s2',0,7,'','',32,NULL),
    ('deleted','owner','statute','gone-act','gone','Gone Act','Cap 2',
     '/statute/gone-act#s1','s1',0,4,'','',33,34)`).run();
  db.exec(read("migrations/0020_private_research_foundation.sql"));

  const root = db
    .prepare(
      "SELECT savedAt, activityAt, path FROM saved_authorities WHERE id='saved'",
    )
    .get();
  assert.deepEqual(
    { ...root },
    { savedAt: 10, activityAt: 31, path: "/judgment/doc" },
  );
  assert.equal(
    db
      .prepare("SELECT authorityId FROM passage_annotations WHERE id='active'")
      .get().authorityId,
    "saved",
  );
  assert.deepEqual(
    db
      .prepare(`SELECT id, title, citation, path FROM passage_annotations
        WHERE id IN ('active', 'second') ORDER BY id`)
      .all()
      .map((row) => ({ ...row })),
    [
      {
        id: "active",
        title: "Captured title",
        citation: "[2024] 1",
        path: "/judgment/doc#p1",
      },
      {
        id: "second",
        title: "Earlier title",
        citation: "[2023] 2",
        path: "/judgment/doc#p2",
      },
    ],
  );
  assert.equal(
    db
      .prepare(`SELECT path FROM saved_authorities
        WHERE userId='owner' AND docType='statute' AND docId='act'`)
      .get().path,
    "/statute/act",
  );
  assert.equal(
    db.prepare("SELECT id FROM passage_annotations WHERE id='deleted'").get(),
    undefined,
  );
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("migration preserves a still-valid legacy quote undo", () => {
  const db = migratedDb();
  const now = Date.now();
  db.prepare(`INSERT INTO saved_quotes VALUES
    ('recent-delete','owner','statute','recent-act','text','Recent Act','Cap 3',
     '/statute/recent-act#s1','s1',0,4,'before','after',?,?),
    ('expired-delete','owner','statute','expired-act','old','Expired Act','Cap 4',
     '/statute/expired-act#s1','s1',0,3,'','',?,?)`).run(
    now - 6_000,
    now - 5_000,
    now - 30_000,
    now - 10_100,
  );
  db.exec(read("migrations/0020_private_research_foundation.sql"));

  assert.deepEqual(
    {
      ...db
        .prepare(`SELECT p.id, p.deletedAt, q.annotationId
          FROM passage_annotations p
          JOIN private_research_quote_aliases q
            ON q.userId=p.userId AND q.annotationId=p.id
          WHERE p.userId='owner' AND q.quoteId='recent-delete'`)
        .get(),
    },
    {
      id: "recent-delete",
      deletedAt: now - 5_000,
      annotationId: "recent-delete",
    },
  );
  assert.equal(
    db
      .prepare("SELECT id FROM passage_annotations WHERE id='expired-delete'")
      .get(),
    undefined,
  );
  assert.equal(
    db.prepare("SELECT id FROM saved_quotes WHERE id='expired-delete'").get(),
    undefined,
  );
  const restoredAt = Date.now();
  const restored = db
    .prepare(`UPDATE passage_annotations
      SET deletedAt=NULL, updatedAt=MAX(updatedAt, ?)
      WHERE userId=? AND id=? AND deletedAt >= ? AND updatedAt <= ?
      RETURNING id`)
    .get(restoredAt, "owner", "recent-delete", restoredAt - 10_000, restoredAt);
  assert.equal(restored.id, "recent-delete");
});

test("a delayed canonical restore cannot override a newer delete", () => {
  const db = migratedDb();
  db.exec(read("migrations/0020_private_research_foundation.sql"));
  db.prepare(`INSERT INTO saved_authorities
    (id,userId,docType,docId,title,path,createdAt,updatedAt,citation,savedAt,activityAt)
    VALUES ('restore-root','owner','judgment','restore-doc','Title',
      '/judgment/restore-doc',90,100,'Cite',NULL,100)`).run();
  db.prepare(`INSERT INTO passage_annotations
    (id,userId,authorityId,title,citation,path,exactText,anchor,startOffset,
     endOffset,contextBefore,contextAfter,note,createdAt,updatedAt,deletedAt)
    VALUES ('restore-annotation','owner','restore-root','Title','Cite',
      '/judgment/restore-doc#p1','text','p1',0,4,'','',NULL,90,115,115)`).run();
  const restore = db.prepare(`UPDATE passage_annotations
    SET deletedAt=NULL, updatedAt=MAX(updatedAt, ?)
    WHERE userId=? AND id=? AND deletedAt >= ? AND updatedAt <= ?
    RETURNING id`);

  assert.equal(
    restore.get(125, "owner", "restore-annotation", 115, 125).id,
    "restore-annotation",
  );
  db.prepare(`UPDATE passage_annotations
    SET deletedAt=130, updatedAt=130 WHERE id='restore-annotation'`).run();
  assert.equal(
    restore.get(120, "owner", "restore-annotation", 110, 120),
    undefined,
  );
  assert.deepEqual(
    {
      ...db
        .prepare(`SELECT deletedAt, updatedAt FROM passage_annotations
          WHERE id='restore-annotation'`)
        .get(),
    },
    { deletedAt: 130, updatedAt: 130 },
  );
});

test("migration aliases every legacy duplicate to its canonical annotation", () => {
  const db = migratedDb();
  db.exec("DROP INDEX idx_saved_quotes_active_location");
  db.prepare(`INSERT INTO saved_quotes VALUES
    ('duplicate-a','owner','judgment','duplicate-doc','same text','Title','Cite',
     '/judgment/duplicate-doc#p1','p1',0,9,'before','after',30,NULL),
    ('duplicate-b','owner','judgment','duplicate-doc','same text','Title','Cite',
     '/judgment/duplicate-doc#p1','p1',0,9,'before','after',31,NULL)`).run();
  db.exec(read("migrations/0020_private_research_foundation.sql"));

  const annotations = db
    .prepare(`SELECT id FROM passage_annotations WHERE userId='owner'`)
    .all();
  assert.equal(annotations.length, 1);
  assert.deepEqual(
    db
      .prepare(`SELECT quoteId, annotationId
        FROM private_research_quote_aliases
        WHERE userId='owner' ORDER BY quoteId`)
      .all()
      .map((row) => ({ ...row })),
    [
      { quoteId: "duplicate-a", annotationId: annotations[0].id },
      { quoteId: "duplicate-b", annotationId: annotations[0].id },
    ],
  );
});

test("old-worker duplicate deletes and restores remain synchronized and bounded", () => {
  const db = migratedDb();
  db.exec("DROP INDEX idx_saved_quotes_active_location");
  db.prepare(`INSERT INTO saved_quotes VALUES
    ('owner-old-a','owner','judgment','old-doc','same text','Title','Cite',
     '/judgment/old-doc#p1','p1',0,9,'before','after',30,NULL),
    ('owner-old-b','owner','judgment','old-doc','same text','Title','Cite',
     '/judgment/old-doc#p1','p1',0,9,'before','after',31,NULL),
    ('other-old','other','judgment','old-doc','other text','Other','Other cite',
     '/judgment/old-doc#p2','p2',0,10,'','',32,NULL)`).run();
  db.exec(read("migrations/0020_private_research_foundation.sql"));
  db.exec("PRAGMA recursive_triggers=ON");

  const annotationId = db
    .prepare(`SELECT annotationId FROM private_research_quote_aliases
      WHERE userId='owner' AND quoteId='owner-old-a'`)
    .get().annotationId;
  const authorityId = db
    .prepare("SELECT authorityId FROM passage_annotations WHERE id=?")
    .get(annotationId).authorityId;
  const legacyRows = () =>
    db
      .prepare(`SELECT id, deletedAt FROM saved_quotes
        WHERE userId='owner' ORDER BY id`)
      .all()
      .map((row) => ({ ...row }));

  const validDeleteAt = Date.now() - 1_000;
  db.prepare("UPDATE saved_quotes SET deletedAt=? WHERE id='owner-old-a'").run(
    validDeleteAt,
  );
  assert.deepEqual(legacyRows(), [
    { id: "owner-old-a", deletedAt: validDeleteAt },
    { id: "owner-old-b", deletedAt: validDeleteAt },
  ]);
  assert.equal(
    db
      .prepare("SELECT deletedAt FROM passage_annotations WHERE id=?")
      .get(annotationId).deletedAt,
    validDeleteAt,
  );

  const validRestore = db
    .prepare(
      "UPDATE saved_quotes SET deletedAt=NULL WHERE id='owner-old-b' RETURNING id",
    )
    .all();
  assert.deepEqual(
    validRestore.map((row) => row.id),
    ["owner-old-b"],
  );
  assert.deepEqual(legacyRows(), [
    { id: "owner-old-a", deletedAt: null },
    { id: "owner-old-b", deletedAt: null },
  ]);
  assert.equal(
    db
      .prepare("SELECT deletedAt FROM passage_annotations WHERE id=?")
      .get(annotationId).deletedAt,
    null,
  );
  assert.equal(
    db
      .prepare("SELECT savedAt FROM saved_authorities WHERE id=?")
      .get(authorityId).savedAt,
    null,
  );

  db.prepare(`UPDATE passage_annotations
    SET deletedAt=NULL, updatedAt=100 WHERE id=?`).run(annotationId);
  const expiredDeleteAt = Date.now() - 20_000;
  db.prepare("UPDATE saved_quotes SET deletedAt=? WHERE id='owner-old-a'").run(
    expiredDeleteAt,
  );
  const expiredRestore = db
    .prepare(
      "UPDATE saved_quotes SET deletedAt=NULL WHERE id='owner-old-b' RETURNING id",
    )
    .all();
  assert.deepEqual(expiredRestore, []);
  assert.deepEqual(legacyRows(), [
    { id: "owner-old-a", deletedAt: expiredDeleteAt },
    { id: "owner-old-b", deletedAt: expiredDeleteAt },
  ]);
  assert.equal(
    db
      .prepare("SELECT deletedAt FROM passage_annotations WHERE id=?")
      .get(annotationId).deletedAt,
    expiredDeleteAt,
  );

  const newerDeleteAt = Date.now() - 500;
  db.prepare(`UPDATE passage_annotations
    SET deletedAt=?, updatedAt=? WHERE id=?`).run(
    newerDeleteAt,
    newerDeleteAt,
    annotationId,
  );
  const staleRestore = db
    .prepare(
      "UPDATE saved_quotes SET deletedAt=NULL WHERE id='owner-old-a' RETURNING id",
    )
    .all();
  assert.deepEqual(staleRestore, []);
  assert.deepEqual(legacyRows(), [
    { id: "owner-old-a", deletedAt: expiredDeleteAt },
    { id: "owner-old-b", deletedAt: expiredDeleteAt },
  ]);
  assert.equal(
    db
      .prepare("SELECT deletedAt FROM passage_annotations WHERE id=?")
      .get(annotationId).deletedAt,
    newerDeleteAt,
  );
  assert.equal(
    db.prepare("SELECT deletedAt FROM saved_quotes WHERE id='other-old'").get()
      .deletedAt,
    null,
  );
});

test("migration bridges old-worker writes during deployment overlap", () => {
  const db = migratedDb();
  db.exec(read("migrations/0020_private_research_foundation.sql"));

  db.prepare(`INSERT INTO saved_authorities
    (id,userId,docType,docId,title,path,createdAt,updatedAt)
    VALUES ('late-save','owner','judgment','late','Late','/judgment/late',40,41)`).run();
  assert.deepEqual(
    {
      ...db
        .prepare(`SELECT savedAt, activityAt FROM saved_authorities
          WHERE id='late-save'`)
        .get(),
    },
    { savedAt: 40, activityAt: 41 },
  );

  db.prepare(`INSERT INTO saved_quotes VALUES
    ('late-quote','owner','statute','late-act','text','Late Act','Cap 9',
     '/statute/late-act#s1','s1',0,4,'before','after',50,NULL)`).run();
  const lateRoot = db
    .prepare(`SELECT id, path, savedAt FROM saved_authorities
      WHERE userId='owner' AND docType='statute' AND docId='late-act'`)
    .get();
  assert.deepEqual(
    { ...lateRoot },
    { id: "quote-root:late-quote", path: "/statute/late-act", savedAt: null },
  );
  assert.equal(
    db
      .prepare("SELECT path FROM passage_annotations WHERE id='late-quote'")
      .get().path,
    "/statute/late-act#s1",
  );

  db.prepare(`INSERT INTO saved_authorities
    (id,userId,docType,docId,title,path,createdAt,updatedAt)
    VALUES ('ignored','owner','statute','late-act','Late Act',
      '/statute/late-act',50,60)
    ON CONFLICT(userId,docType,docId) DO UPDATE SET
      title=excluded.title,path=excluded.path,updatedAt=excluded.updatedAt`).run();
  assert.equal(
    db
      .prepare("SELECT savedAt FROM saved_authorities WHERE id=?")
      .get(lateRoot.id).savedAt,
    60,
  );
  db.prepare(`UPDATE saved_authorities
    SET savedAt=NULL, activityAt=70, updatedAt=70 WHERE id=?`).run(lateRoot.id);
  assert.equal(
    db
      .prepare("SELECT savedAt FROM saved_authorities WHERE id=?")
      .get(lateRoot.id).savedAt,
    null,
  );

  const legacyDeleteAt = Date.now() - 100;
  db.prepare("UPDATE saved_quotes SET deletedAt=? WHERE id='late-quote'").run(
    legacyDeleteAt,
  );
  assert.equal(
    db
      .prepare(
        "SELECT deletedAt FROM passage_annotations WHERE id='late-quote'",
      )
      .get().deletedAt,
    legacyDeleteAt,
  );
  db.prepare(
    "UPDATE saved_quotes SET deletedAt=NULL WHERE id='late-quote'",
  ).run();
  assert.equal(
    db
      .prepare(
        "SELECT deletedAt FROM passage_annotations WHERE id='late-quote'",
      )
      .get().deletedAt,
    null,
  );

  db.prepare("DELETE FROM saved_authorities WHERE id=?").run(lateRoot.id);
  assert.equal(
    db
      .prepare("SELECT savedAt FROM saved_authorities WHERE id=?")
      .get(lateRoot.id).savedAt,
    null,
  );
  assert.equal(
    db.prepare("SELECT id FROM passage_annotations WHERE id='late-quote'").get()
      .id,
    "late-quote",
  );

  db.prepare(`INSERT INTO saved_quotes VALUES
    ('other-quote','other','judgment','other-doc','text','Other','[2024] 2',
     '/judgment/other-doc#p1','p1',0,4,'','',80,NULL)`).run();
  db.prepare(`INSERT INTO private_research_document_delete_watermarks
    (userId,docType,docId,deletedAt)
    VALUES ('other','judgment','other-doc',90)`).run();
  db.prepare("DELETE FROM user WHERE id='other'").run();
  assert.equal(
    db.prepare("SELECT id FROM saved_authorities WHERE userId='other'").get(),
    undefined,
  );
  assert.equal(
    db
      .prepare(`SELECT userId FROM private_research_document_delete_watermarks
        WHERE userId='other'`)
      .get(),
    undefined,
  );

  db.prepare("DELETE FROM passage_annotations WHERE id='late-quote'").run();
  db.prepare("DELETE FROM saved_quotes WHERE id='late-quote'").run();
  db.prepare(`DELETE FROM private_research_authority_guards
    WHERE userId='owner' AND authorityId=?
      AND NOT EXISTS (SELECT 1 FROM passage_annotations
        WHERE userId='owner' AND authorityId=?)`).run(lateRoot.id, lateRoot.id);
  db.prepare("DELETE FROM saved_authorities WHERE id=?").run(lateRoot.id);
  assert.equal(
    db.prepare("SELECT id FROM saved_authorities WHERE id=?").get(lateRoot.id),
    undefined,
  );
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("late legacy quote IDs alias to canonical annotations through cleanup", () => {
  const db = migratedDb();
  db.exec(read("migrations/0020_private_research_foundation.sql"));
  db.prepare(`INSERT INTO saved_authorities
    (id,userId,docType,docId,title,path,createdAt,updatedAt,citation,savedAt,activityAt)
    VALUES ('canonical-root','owner','judgment','canonical-doc','Title',
      '/judgment/canonical-doc',100,100,'Cite',NULL,100)`).run();
  db.prepare(`INSERT INTO passage_annotations
    (id,userId,authorityId,title,citation,path,exactText,anchor,startOffset,
     endOffset,contextBefore,contextAfter,note,createdAt,updatedAt,deletedAt)
    VALUES ('canonical-annotation','owner','canonical-root','Title','Cite',
      '/judgment/canonical-doc#p1','same text','p1',0,9,'before','after',
      NULL,100,100,NULL)`).run();
  db.prepare(`INSERT INTO private_research_authority_guards
    (userId,authorityId) VALUES ('owner','canonical-root')`).run();

  db.prepare(`INSERT INTO saved_quotes VALUES
    ('late-legacy-id','owner','judgment','canonical-doc','same text','Title',
     'Cite','/judgment/canonical-doc#p1','p1',0,9,'before','after',110,NULL)`).run();
  assert.deepEqual(
    db
      .prepare(`SELECT id FROM passage_annotations
        WHERE userId='owner' AND authorityId='canonical-root'`)
      .all()
      .map((row) => row.id),
    ["canonical-annotation"],
  );
  const resolved = db
    .prepare(`SELECT annotationId FROM private_research_quote_aliases
      WHERE userId=? AND quoteId=?`)
    .get("owner", "late-legacy-id").annotationId;
  assert.equal(resolved, "canonical-annotation");

  const overlapNow = Date.now() - 1_000;
  db.prepare(
    "UPDATE saved_quotes SET deletedAt=? WHERE id='late-legacy-id'",
  ).run(overlapNow);
  assert.equal(
    db
      .prepare("SELECT deletedAt FROM passage_annotations WHERE id=?")
      .get(resolved).deletedAt,
    overlapNow,
  );
  db.prepare(
    "UPDATE saved_quotes SET deletedAt=NULL WHERE id='late-legacy-id'",
  ).run();
  assert.equal(
    db
      .prepare("SELECT deletedAt FROM passage_annotations WHERE id=?")
      .get(resolved).deletedAt,
    null,
  );

  const staleDeleteAt = overlapNow + 100;
  const newerDeleteAt = overlapNow + 200;
  db.prepare(
    "UPDATE saved_quotes SET deletedAt=? WHERE id='late-legacy-id'",
  ).run(staleDeleteAt);
  db.prepare(`UPDATE passage_annotations
    SET deletedAt=NULL, updatedAt=? WHERE id=?`).run(
    staleDeleteAt + 50,
    resolved,
  );
  db.prepare(`UPDATE passage_annotations
    SET deletedAt=?, updatedAt=? WHERE id=?`).run(
    newerDeleteAt,
    newerDeleteAt,
    resolved,
  );
  db.prepare(
    "UPDATE saved_quotes SET deletedAt=NULL WHERE id='late-legacy-id'",
  ).run();
  assert.equal(
    db
      .prepare("SELECT deletedAt FROM passage_annotations WHERE id=?")
      .get(resolved).deletedAt,
    newerDeleteAt,
  );

  const finalLegacyDeleteAt = overlapNow + 300;
  const finalCanonicalDeleteAt = overlapNow + 400;
  db.prepare(
    "UPDATE saved_quotes SET deletedAt=? WHERE id='late-legacy-id'",
  ).run(finalLegacyDeleteAt);
  db.prepare(`UPDATE passage_annotations
    SET deletedAt=?, updatedAt=? WHERE id=?`).run(
    finalCanonicalDeleteAt,
    finalCanonicalDeleteAt,
    resolved,
  );
  db.prepare(`INSERT INTO saved_quotes VALUES
    ('second-legacy-id','owner','judgment','canonical-doc','same text','Title',
     'Cite','/judgment/canonical-doc#p1','p1',0,9,'before','after',125,NULL)`).run();
  assert.equal(
    db
      .prepare("SELECT deletedAt FROM passage_annotations WHERE id=?")
      .get(resolved).deletedAt,
    finalCanonicalDeleteAt,
  );
  assert.equal(
    db
      .prepare(`SELECT annotationId FROM private_research_quote_aliases
        WHERE userId='owner' AND quoteId='second-legacy-id'`)
      .get().annotationId,
    resolved,
  );

  db.prepare(`INSERT INTO private_research_document_delete_watermarks
    (userId,docType,docId,deletedAt)
    VALUES ('owner','judgment','canonical-doc',180)
    ON CONFLICT(userId,docType,docId) DO UPDATE SET
      deletedAt=MAX(private_research_document_delete_watermarks.deletedAt,
        excluded.deletedAt)`).run();
  db.prepare(
    "DELETE FROM passage_annotations WHERE userId=? AND id=? RETURNING authorityId",
  ).get("owner", resolved);
  db.prepare(`DELETE FROM saved_quotes
    WHERE userId=? AND (id=? OR id IN (
      SELECT quoteId FROM private_research_quote_aliases
      WHERE userId=? AND annotationId=?
    ))`).run("owner", resolved, "owner", resolved);
  db.prepare(`DELETE FROM private_research_quote_aliases
    WHERE userId=? AND annotationId=?`).run("owner", resolved);
  db.prepare(`DELETE FROM private_research_authority_guards
    WHERE userId=? AND authorityId=?
      AND NOT EXISTS (SELECT 1 FROM passage_annotations
        WHERE userId=? AND authorityId=?)`).run(
    "owner",
    "canonical-root",
    "owner",
    "canonical-root",
  );
  db.prepare(`DELETE FROM saved_authorities
    WHERE userId=? AND id=? AND savedAt IS NULL
      AND NOT EXISTS (SELECT 1 FROM passage_annotations
        WHERE userId=? AND authorityId=?)`).run(
    "owner",
    "canonical-root",
    "owner",
    "canonical-root",
  );
  assert.equal(
    db
      .prepare(`SELECT COUNT(*) AS count FROM saved_quotes
        WHERE userId='owner' AND docId='canonical-doc'`)
      .get().count,
    0,
  );
  assert.equal(
    db
      .prepare(`SELECT COUNT(*) AS count FROM private_research_quote_aliases
        WHERE userId='owner' AND annotationId=?`)
      .get(resolved).count,
    0,
  );
  assert.equal(
    db
      .prepare("SELECT id FROM saved_authorities WHERE id='canonical-root'")
      .get(),
    undefined,
  );

  db.prepare(`INSERT INTO saved_quotes VALUES
    ('stale-after-delete','owner','judgment','canonical-doc','same text','Title',
     'Cite','/judgment/canonical-doc#p1','p1',0,9,'before','after',175,NULL)`).run();
  assert.equal(
    db
      .prepare("SELECT id FROM saved_quotes WHERE id='stale-after-delete'")
      .get(),
    undefined,
  );
  assert.equal(
    db.prepare("SELECT id FROM passage_annotations WHERE userId='owner'").get(),
    undefined,
  );

  db.prepare(`INSERT INTO saved_authorities
    (id,userId,docType,docId,title,path,createdAt,updatedAt,
     citation,savedAt,activityAt)
    SELECT 'stale-canonical-root','owner','judgment','canonical-doc','Title',
      '/judgment/canonical-doc',175,175,'Cite',NULL,175
    WHERE NOT EXISTS (
      SELECT 1 FROM private_research_document_delete_watermarks
      WHERE userId='owner' AND docType='judgment' AND docId='canonical-doc'
        AND deletedAt >= 175
    )`).run();
  assert.equal(
    db
      .prepare(
        "SELECT id FROM saved_authorities WHERE id='stale-canonical-root'",
      )
      .get(),
    undefined,
  );
});

test("legacy Undo synchronization and expiry purge remove private compatibility data", () => {
  const db = migratedDb();
  db.exec("DROP INDEX idx_saved_quotes_active_location");
  db.prepare(`INSERT INTO saved_authorities
    (id,userId,docType,docId,title,path,createdAt,updatedAt)
    VALUES ('explicit-root','owner','statute','explicit-doc','Explicit Act',
      '/statute/explicit-doc',10,10)`).run();
  db.prepare(`INSERT INTO saved_quotes VALUES
    ('owner-a','owner','judgment','owner-doc','same text','Owner title','Cite',
     '/judgment/owner-doc#p1','p1',0,9,'before','after',100,NULL),
    ('owner-b','owner','judgment','owner-doc','same text','Owner title','Cite',
     '/judgment/owner-doc#p1','p1',0,9,'before','after',101,NULL),
    ('explicit-quote','owner','statute','explicit-doc','section text',
     'Explicit Act','Cap 1','/statute/explicit-doc#s1','s1',0,12,'','',102,NULL),
    ('other-quote','other','judgment','other-doc','other text','Other title',
     'Other cite','/judgment/other-doc#p1','p1',0,10,'','',103,NULL)`).run();
  db.exec(read("migrations/0020_private_research_foundation.sql"));

  const model = read("src/lib/private-annotations.ts");
  const statements = (start, end) => {
    const section = model.slice(model.indexOf(start), model.indexOf(end));
    return [...section.matchAll(/\.prepare\(`([\s\S]*?)`\)/g)].map(
      (match) => match[1],
    );
  };
  const purgeSql = statements(
    "async function purgeExpiredSoftDeletedAnnotationsWithDb",
    "export async function purgeExpiredSoftDeletedAnnotations",
  );
  const softDeleteSql = statements(
    "export async function softDeleteAnnotation",
    "export async function restoreSoftDeletedAnnotation",
  );
  const restoreSql = statements(
    "export async function restoreSoftDeletedAnnotation",
    "type Cursor",
  );
  assert.equal(purgeSql.length, 6);
  assert.equal(softDeleteSql.length, 2);
  assert.equal(restoreSql.length, 4);

  const annotationId = (quoteId, userId = "owner") =>
    db
      .prepare(`SELECT annotationId FROM private_research_quote_aliases
        WHERE userId=? AND quoteId=?`)
      .get(userId, quoteId).annotationId;
  const ownerAnnotation = annotationId("owner-a");
  assert.equal(annotationId("owner-b"), ownerAnnotation);
  const explicitAnnotation = annotationId("explicit-quote");
  const otherAnnotation = annotationId("other-quote", "other");
  const ownerRoot = db
    .prepare("SELECT authorityId FROM passage_annotations WHERE id=?")
    .get(ownerAnnotation).authorityId;
  const otherRoot = db
    .prepare("SELECT authorityId FROM passage_annotations WHERE id=?")
    .get(otherAnnotation).authorityId;

  const softDelete = (userId, id, deletedAt) => {
    const deleted = db
      .prepare(softDeleteSql[0])
      .all(deletedAt, deletedAt, userId, id, deletedAt);
    db.prepare(softDeleteSql[1]).run(
      deletedAt,
      userId,
      id,
      userId,
      id,
      userId,
      id,
      deletedAt,
    );
    assert.deepEqual(
      deleted.map((row) => row.id),
      [id],
    );
  };
  const restore = (userId, id, now) => {
    const tombstone = db.prepare(restoreSql[0]).get(userId, id);
    const restored = db
      .prepare(restoreSql[1])
      .all(now, userId, id, tombstone.deletedAt, now - 10_000, now);
    db.prepare(restoreSql[2]).run(userId, id, userId, id, userId, id, now);
    db.prepare(restoreSql[3]).run(
      now,
      now,
      userId,
      tombstone.authorityId,
      userId,
      id,
      now,
    );
    assert.deepEqual(
      restored.map((row) => row.id),
      [id],
    );
  };

  softDelete("owner", ownerAnnotation, 1_000);
  assert.deepEqual(
    db
      .prepare(`SELECT id, deletedAt FROM saved_quotes
        WHERE userId='owner' AND docId='owner-doc' ORDER BY id`)
      .all()
      .map((row) => ({ ...row })),
    [
      { id: "owner-a", deletedAt: 1_000 },
      { id: "owner-b", deletedAt: 1_000 },
    ],
  );
  assert.equal(
    db
      .prepare("SELECT deletedAt FROM saved_quotes WHERE id='other-quote'")
      .get().deletedAt,
    null,
  );

  restore("owner", ownerAnnotation, 1_100);
  assert.equal(
    db
      .prepare(`SELECT COUNT(*) AS count FROM saved_quotes
        WHERE userId='owner' AND docId='owner-doc' AND deletedAt IS NOT NULL`)
      .get().count,
    0,
  );
  assert.equal(
    db
      .prepare("SELECT deletedAt FROM passage_annotations WHERE id=?")
      .get(ownerAnnotation).deletedAt,
    null,
  );
  assert.equal(
    db
      .prepare("SELECT savedAt FROM saved_authorities WHERE id=?")
      .get(ownerRoot).savedAt,
    null,
  );

  softDelete("owner", ownerAnnotation, 20_000);
  softDelete("owner", explicitAnnotation, 20_001);
  softDelete("other", otherAnnotation, 20_002);
  const purgeAt = 31_000;
  const cutoff = purgeAt - 10_000;
  db.prepare(purgeSql[0]).run(purgeAt, "owner", cutoff);
  db.prepare(purgeSql[1]).run("owner", "owner", cutoff, "owner", cutoff);
  db.prepare(purgeSql[2]).run("owner", "owner", cutoff);
  db.prepare(purgeSql[3]).run("owner", cutoff);
  db.prepare(purgeSql[4]).run("owner", "owner");
  db.prepare(purgeSql[5]).run("owner", "owner");

  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM passage_annotations WHERE userId='owner'",
      )
      .get().count,
    0,
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM saved_quotes WHERE userId='owner'",
      )
      .get().count,
    0,
  );
  assert.equal(
    db
      .prepare(`SELECT COUNT(*) AS count FROM private_research_quote_aliases
        WHERE userId='owner'`)
      .get().count,
    0,
  );
  assert.equal(
    db
      .prepare(`SELECT COUNT(*) AS count FROM private_research_authority_guards
        WHERE userId='owner'`)
      .get().count,
    0,
  );
  assert.equal(
    db.prepare("SELECT id FROM saved_authorities WHERE id=?").get(ownerRoot),
    undefined,
  );
  assert.deepEqual(
    {
      ...db
        .prepare(
          "SELECT id, savedAt FROM saved_authorities WHERE id='explicit-root'",
        )
        .get(),
    },
    { id: "explicit-root", savedAt: 10 },
  );
  assert.deepEqual(
    db
      .prepare(`SELECT docId, deletedAt
        FROM private_research_document_delete_watermarks
        WHERE userId='owner' ORDER BY docId`)
      .all()
      .map((row) => ({ ...row })),
    [
      { docId: "explicit-doc", deletedAt: purgeAt },
      { docId: "owner-doc", deletedAt: purgeAt },
    ],
  );

  assert.equal(
    db
      .prepare("SELECT deletedAt FROM passage_annotations WHERE id=?")
      .get(otherAnnotation).deletedAt,
    20_002,
  );
  assert.equal(
    db
      .prepare("SELECT deletedAt FROM saved_quotes WHERE id='other-quote'")
      .get().deletedAt,
    20_002,
  );
  assert.equal(
    db
      .prepare(`SELECT annotationId FROM private_research_quote_aliases
        WHERE userId='other' AND quoteId='other-quote'`)
      .get().annotationId,
    otherAnnotation,
  );
  assert.equal(
    db
      .prepare(`SELECT authorityId FROM private_research_authority_guards
        WHERE userId='other' AND authorityId=?`)
      .get(otherRoot).authorityId,
    otherRoot,
  );

  db.prepare(`INSERT INTO saved_quotes VALUES
    ('stale-after-expiry','owner','judgment','owner-doc','stale text',
     'Owner title','Cite','/judgment/owner-doc#p2','p2',0,10,'','',30_000,NULL)`).run();
  assert.equal(
    db
      .prepare("SELECT id FROM saved_quotes WHERE id='stale-after-expiry'")
      .get(),
    undefined,
  );
  db.prepare(`INSERT INTO saved_authorities
    (id,userId,docType,docId,title,path,createdAt,updatedAt,
     citation,savedAt,activityAt)
    SELECT 'stale-root','owner','judgment','owner-doc','Owner title',
      '/judgment/owner-doc',30000,30000,'Cite',NULL,30000
    WHERE NOT EXISTS (
      SELECT 1 FROM private_research_document_delete_watermarks
      WHERE userId='owner' AND docType='judgment' AND docId='owner-doc'
        AND deletedAt >= 30000
    )`).run();
  assert.equal(
    db.prepare("SELECT id FROM saved_authorities WHERE id='stale-root'").get(),
    undefined,
  );
});

test("annotation dedupe and owner-bound parent constraints are enforced", () => {
  const db = migratedDb();
  db.exec(read("migrations/0020_private_research_foundation.sql"));
  db.prepare(`INSERT INTO saved_authorities
    (id,userId,docType,docId,title,path,createdAt,updatedAt,citation,savedAt,activityAt)
    VALUES ('root','owner','judgment','doc','T','/judgment/doc',1,1,'C',NULL,1)`).run();
  const insert = db.prepare(`INSERT INTO passage_annotations
    (id,userId,authorityId,title,citation,path,exactText,anchor,startOffset,
     endOffset,contextBefore,contextAfter,note,createdAt,updatedAt,deletedAt)
    VALUES (?, ?, ?, 'T', 'C', '/judgment/doc#p', 'text', 'p', 0, 4,
      '', '', NULL, 1, 1, NULL)`);
  insert.run("one", "owner", "root");
  assert.throws(() => insert.run("two", "owner", "root"), /UNIQUE/);
  assert.throws(() => insert.run("foreign", "other", "root"), /FOREIGN KEY/);
});

test("all private routes wrap every handler with the private response helper", () => {
  const helper = read("src/lib/private-response.ts");
  assert.match(helper, /private, no-store, max-age=0/);
  assert.match(helper, /Pragma: "no-cache"/);
  assert.match(helper, /noindex, nofollow, noarchive/);
  assert.match(helper, /catch \{[\s\S]*return privateJson\(/);
  for (const route of privateRoutes) {
    const source = read(route);
    const handlers =
      source.match(/export async function (?:GET|POST|PATCH|DELETE)/g) ?? [];
    const wrappers =
      source.match(/return privateRoute\(async \(\) => \{/g) ?? [];
    assert.ok(handlers.length > 0, route);
    assert.equal(wrappers.length, handlers.length, route);
    assert.match(source, /privateJson/, route);
    assert.doesNotMatch(source, /Response\.json/, route);
  }
});

test("legacy quote adapters soft-delete and restore canonical annotations", () => {
  const collection = read("src/app/api/quotes/route.ts");
  const item = read("src/app/api/quotes/[id]/route.ts");
  const model = read("src/lib/private-annotations.ts");
  const annotationItem = read("src/app/api/annotations/[id]/route.ts");
  const migration = read("migrations/0020_private_research_foundation.sql");
  assert.match(collection, /createAnnotation/);
  assert.match(item, /softDeleteAnnotation/);
  assert.match(item, /restoreSoftDeletedAnnotation/);
  assert.equal(
    (item.match(/const id = await resolveLegacyAnnotationId/g) ?? []).length,
    3,
  );
  assert.match(model, /SET deletedAt = \?, updatedAt = MAX/);
  assert.match(model, /deletedAt >= \?[\s\S]*AND updatedAt <= \?/);
  assert.match(model, /LEGACY_QUOTE_RESTORE_WINDOW_MS = 10_000/);
  const softDelete = model.slice(
    model.indexOf("export async function softDeleteAnnotation"),
    model.indexOf("export async function restoreSoftDeletedAnnotation"),
  );
  assert.match(softDelete, /db\.batch/);
  assert.match(softDelete, /UPDATE saved_quotes SET deletedAt = \?/);
  assert.match(softDelete, /WHERE userId = \?[\s\S]*annotationId = \?/);
  const restore = model.slice(
    model.indexOf("export async function restoreSoftDeletedAnnotation"),
    model.indexOf("type Cursor"),
  );
  assert.match(restore, /db\.batch/);
  assert.match(restore, /UPDATE saved_quotes SET deletedAt = NULL/);
  assert.match(restore, /deletedAt IS NULL AND updatedAt = \?/);
  const purge = model.slice(
    model.indexOf("async function purgeExpiredSoftDeletedAnnotationsWithDb"),
    model.indexOf("export async function purgeExpiredSoftDeletedAnnotations"),
  );
  assert.match(purge, /private_research_document_delete_watermarks/);
  assert.match(purge, /DELETE FROM saved_quotes/);
  assert.match(purge, /DELETE FROM private_research_quote_aliases/);
  assert.match(purge, /DELETE FROM passage_annotations/);
  assert.match(purge, /DELETE FROM private_research_authority_guards/);
  assert.match(purge, /savedAt IS NULL/);
  assert.match(
    model,
    /resolveLegacyAnnotationId[\s\S]*purgeExpiredSoftDeletedAnnotationsWithDb/,
  );
  assert.equal(
    (model.match(/await purgeExpiredSoftDeletedAnnotationsWithDb/g) ?? [])
      .length,
    4,
  );
  assert.match(
    annotationItem,
    /export async function DELETE[\s\S]*deleteAnnotation/,
  );
  assert.doesNotMatch(
    privateRoutes.map(read).join("\n"),
    /saved-quotes|saved_quotes|restoreSavedQuote/,
  );
  assert.match(migration, /deletedAt INTEGER/);
  assert.match(
    migration,
    /julianday\('now'\)[\s\S]*86400000 AS INTEGER\)[\s\S]*- 10000/,
  );
  assert.match(
    migration,
    /q\.id, q\.userId, a\.id, q\.sourceTitle, q\.citation, q\.path/,
  );
  assert.match(migration, /DELETE FROM saved_quotes[\s\S]*restoreCutoff/);
  const create = model.slice(
    model.indexOf("export async function createAnnotation"),
    model.indexOf("export async function getAnnotation"),
  );
  assert.ok(
    (create.match(/private_research_document_delete_watermarks/g) ?? [])
      .length >= 2,
  );
  assert.match(create, /RETURNING id/);
  assert.match(create, /annotationWrite\.results\.length === 0/);
  const permanentDelete = model.slice(
    model.indexOf("export async function deleteAnnotation"),
    model.indexOf("export async function listLibrary"),
  );
  assert.match(permanentDelete, /RETURNING authorityId/);
  assert.match(permanentDelete, /DELETE FROM saved_quotes/);
  assert.match(
    permanentDelete,
    /SELECT quoteId FROM private_research_quote_aliases/,
  );
  assert.match(permanentDelete, /DELETE FROM private_research_quote_aliases/);
  assert.match(permanentDelete, /private_research_authority_guards/);
  assert.match(permanentDelete, /private_research_document_delete_watermarks/);
  assert.match(permanentDelete, /deleted\.results\.some/);
  assert.doesNotMatch(permanentDelete, /deletedAt IS NULL/);
  assert.match(migration, /private_research_legacy_quote_insert/);
  assert.match(migration, /private_research_reject_stale_quote_insert/);
  assert.match(migration, /private_research_protect_authority_delete/);
});

test("annotation activity remains monotonic under out-of-order requests", () => {
  const source = read("src/lib/private-annotations.ts");
  assert.match(
    source,
    /activityAt = MAX\(saved_authorities\.activityAt, excluded\.activityAt\)/,
  );
  assert.match(
    source,
    /updatedAt = MAX\(passage_annotations\.updatedAt, excluded\.updatedAt\)/,
  );
  assert.match(source, /deletedAt IS NULL AND updatedAt <= \?/);
  assert.match(source, /SET activityAt = MAX\(activityAt, \?\)/);
});

test("explicit saves retain current activity and annotation-only roots remain hidden", () => {
  const source = read("src/lib/saved-workspace.ts");
  assert.match(source, /savedAt IS NOT NULL/);
  assert.match(source, /savedAt = COALESCE\(saved_authorities\.savedAt/);
  assert.match(
    source,
    /activityAt = MAX\(saved_authorities\.activityAt, excluded\.activityAt\)/,
  );
  assert.match(
    source,
    /const now = Date\.now\(\);[\s\S]*citation,\s+now,\s+now,/,
  );
  assert.match(source, /UPDATE saved_authorities SET savedAt = NULL/);
  assert.match(source, /NOT EXISTS \(SELECT 1 FROM passage_annotations/);
  assert.match(
    read("src/app/api/saved/route.ts"),
    /saved: await getSavedAuthority/,
  );
});

test("saved-library refresh and unsave races cannot restore stale state", () => {
  const source = read("src/components/SavedWorkspace.tsx");
  assert.match(
    source,
    /const requestVersion = append[\s\S]*?: \+\+loadVersion\.current/,
  );
  assert.match(
    source,
    /signal\?\.aborted[\s\S]*requestVersion !== loadVersion\.current[\s\S]*requestOwnerVersion !== ownerVersion\.current/,
  );
  assert.match(source, /dataOwnerId === ownerId/);
  assert.match(source, /visibleAuthorities\.map/);
  assert.match(source, /visibleUndoToast/);
  assert.match(source, /removeInFlight\.current/);
  assert.match(source, /removeController\.current\?\.abort\(\)/);
  assert.match(source, /undoController\.current\?\.abort\(\)/);
  assert.match(
    source,
    /controller\.signal\.aborted \|\| version !== ownerVersion\.current/,
  );
  assert.match(
    source,
    /if \(!response\.ok\)[\s\S]*showUndoToast\(item, version\)/,
  );
  assert.doesNotMatch(source, /const previous = authorities/);
  assert.doesNotMatch(source, /setAuthorities\(previous\)/);
});

test("saved authority state and mutations are bound to the current account", () => {
  const source = read("src/components/SavedAuthorityButton.tsx");
  assert.match(source, /JSON\.stringify\(\[userId, docType, docId\]\)/);
  assert.match(source, /const version = \+\+requestVersion\.current/);
  assert.match(source, /setIsSaved\(false\)/);
  assert.match(source, /const stateIsCurrent = dataKey === stateKey/);
  assert.match(
    source,
    /savedDisplay = !isPending && stateIsCurrent && isSaved/,
  );
  assert.match(source, /stateKeyRef\.current !== operationKey/);
  assert.match(source, /mutationController\.current\?\.abort\(\)/);
  assert.match(source, /signal: controller\.signal/);
});

test("annotation requests cannot update a different owner's visible state", () => {
  const source = read("src/components/SavedAnnotations.tsx");
  assert.match(source, /const ownerId = session\?\.user\.id \?\? null/);
  assert.match(source, /const version = \+\+requestVersion\.current/);
  assert.match(source, /dataOwnerId === ownerId/);
  assert.match(source, /paginationController\.current\?\.abort\(\)/);
  assert.match(
    source,
    /controller\.signal\.aborted \|\| version !== requestVersion\.current/,
  );
  assert.match(source, /visibleAnnotations\.map/);
  assert.match(source, /visibleNextCursor/);
});

test("normalization and owner-isolation contracts are explicit", () => {
  const source = read("src/lib/private-annotations.ts");
  assert.match(source, /MAX_NOTE = 10_000/);
  assert.match(source, /normalizeInternalPath/);
  assert.match(source, /endOffset - startOffset !== exactText.length/);
  assert.match(
    source,
    /parsed.owner === owner &&[\s\S]*parsed.shape === shape/,
  );
  assert.match(source, /FOREIGN|userId = \? AND p\.id = \?/i);
  assert.match(source, /p\.title, p\.citation, p\.path/);
  assert.match(source, /canonicalAuthorityPath\(input\.path\)/);
  assert.match(source, /PATCH|updateAnnotationNote/);
});
