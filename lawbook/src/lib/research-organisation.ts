/**
 * Private tags and collections (#197).
 *
 * Three distinct ideas, deliberately kept distinct:
 *
 *   label      — what a *passage* means (Holding, Facts). Lives on the annotation.
 *   tag        — a topic or workflow across documents (Negligence, Exam revision).
 *   collection — a group of authorities for a matter (Tan v Lim, Week 4).
 *
 * Tags and collections are owner-scoped, case-insensitively unique per owner, and
 * archived rather than force-deleted. Deleting either removes memberships only:
 * the authorities and their annotations are never touched, which is the promise
 * #197 makes and the one most worth getting wrong quietly.
 *
 * Naming rules live in research-organisation-names.ts so they can be executed in
 * tests without a D1 binding.
 */
import { getAuthDb } from "@/lib/d1";
import {
  MAX_ITEMS_PER_KIND,
  type OrganisationKind,
} from "@/lib/research-organisation-names";

export type { OrganisationKind } from "@/lib/research-organisation-names";
export {
  isOrganisationKind,
  MAX_ITEMS_PER_KIND,
  normalizeDescription,
  normalizeGroupName,
} from "@/lib/research-organisation-names";

export interface ResearchGroup {
  id: string;
  kind: OrganisationKind;
  name: string;
  description: string | null;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  documentCount: number;
}

interface KindConfig {
  table: string;
  members: string;
  memberKey: string;
  hasDescription: boolean;
}

const KINDS: Record<OrganisationKind, KindConfig> = {
  tag: {
    table: "research_tags",
    members: "research_tag_members",
    memberKey: "tagId",
    hasDescription: false,
  },
  collection: {
    table: "research_collections",
    members: "research_collection_members",
    memberKey: "collectionId",
    hasDescription: true,
  },
};

/**
 * List a reader's tags or collections with the number of documents in each.
 * Archived items are included but flagged, so they stay discoverable without
 * cluttering a default view — the caller decides.
 */
export async function listGroups(
  userId: string,
  kind: OrganisationKind,
): Promise<ResearchGroup[]> {
  const config = KINDS[kind];
  const db = await getAuthDb();
  const description = config.hasDescription ? "g.description" : "NULL";
  const result = await db
    .prepare(`SELECT g.id, g.name, ${description} AS description, g.createdAt,
        g.updatedAt, g.archivedAt,
        (SELECT COUNT(*) FROM ${config.members} m
          WHERE m.userId = g.userId AND m.${config.memberKey} = g.id)
          AS documentCount
      FROM ${config.table} g
      WHERE g.userId = ?
      ORDER BY g.archivedAt IS NOT NULL, g.name COLLATE NOCASE ASC
      LIMIT ?`)
    .bind(userId, MAX_ITEMS_PER_KIND)
    .all<Omit<ResearchGroup, "kind">>();
  return (result.results ?? []).map((row) => ({ ...row, kind }));
}

/**
 * Create a tag or collection, or return the existing one with that name.
 *
 * Idempotent by name so creating inline while saving cannot produce a duplicate,
 * and so a reader who types an existing name is joined to it rather than shown an
 * error they can do nothing useful with.
 */
export async function createGroup(
  userId: string,
  kind: OrganisationKind,
  name: string,
  description: string | null = null,
): Promise<ResearchGroup | null> {
  const config = KINDS[kind];
  const db = await getAuthDb();
  const now = Date.now();
  const id = crypto.randomUUID();
  const columns = config.hasDescription
    ? "(id, userId, name, description, createdAt, updatedAt)"
    : "(id, userId, name, createdAt, updatedAt)";
  const values = config.hasDescription
    ? "(?, ?, ?, ?, ?, ?)"
    : "(?, ?, ?, ?, ?)";
  const params = config.hasDescription
    ? [id, userId, name, description, now, now]
    : [id, userId, name, now, now];
  const count = await db
    .prepare(`SELECT COUNT(*) AS n FROM ${config.table} WHERE userId = ?`)
    .bind(userId)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_ITEMS_PER_KIND) throw new Error("GROUP_LIMIT");
  await db
    .prepare(
      `INSERT INTO ${config.table} ${columns} VALUES ${values}
       ON CONFLICT(userId, name COLLATE NOCASE) DO UPDATE SET
         archivedAt = NULL, updatedAt = excluded.updatedAt`,
    )
    .bind(...params)
    .run();
  const groups = await listGroups(userId, kind);
  return (
    groups.find((g) => g.name.toLowerCase() === name.toLowerCase()) ?? null
  );
}

/** Rename, re-describe, archive or unarchive. Never touches membership. */
export async function updateGroup(
  userId: string,
  kind: OrganisationKind,
  id: string,
  changes: { name?: string; description?: string | null; archived?: boolean },
): Promise<ResearchGroup | null> {
  const config = KINDS[kind];
  const db = await getAuthDb();
  const now = Date.now();
  const sets: string[] = ["updatedAt = ?"];
  const params: unknown[] = [now];
  if (changes.name !== undefined) {
    sets.push("name = ?");
    params.push(changes.name);
  }
  if (changes.description !== undefined && config.hasDescription) {
    sets.push("description = ?");
    params.push(changes.description);
  }
  if (changes.archived !== undefined) {
    sets.push("archivedAt = ?");
    params.push(changes.archived ? now : null);
  }
  const updated = await db
    .prepare(
      `UPDATE ${config.table} SET ${sets.join(", ")}
       WHERE userId = ? AND id = ? RETURNING id`,
    )
    .bind(...params, userId, id)
    .first<{ id: string }>();
  if (!updated) return null;
  const groups = await listGroups(userId, kind);
  return groups.find((g) => g.id === id) ?? null;
}

/**
 * Merge one group into another: memberships move, then the source is deleted.
 * Documents belonging to both end up in the target once, not twice.
 */
export async function mergeGroups(
  userId: string,
  kind: OrganisationKind,
  sourceId: string,
  targetId: string,
): Promise<boolean> {
  if (sourceId === targetId) return false;
  const config = KINDS[kind];
  const db = await getAuthDb();
  const target = await db
    .prepare(`SELECT id FROM ${config.table} WHERE userId = ? AND id = ?`)
    .bind(userId, targetId)
    .first<{ id: string }>();
  if (!target) return false;
  const [moved] = await db.batch<{ authorityId: string }>([
    db
      .prepare(`INSERT OR IGNORE INTO ${config.members}
          (userId, ${config.memberKey}, authorityId, addedAt)
        SELECT userId, ?, authorityId, addedAt FROM ${config.members}
        WHERE userId = ? AND ${config.memberKey} = ?
        RETURNING authorityId`)
      .bind(targetId, userId, sourceId),
    db
      .prepare(`DELETE FROM ${config.table} WHERE userId = ? AND id = ?`)
      .bind(userId, sourceId),
  ]);
  return moved !== undefined;
}

/**
 * Delete a group. Memberships go with it; the authorities and every annotation on
 * them stay exactly as they were.
 */
export async function deleteGroup(
  userId: string,
  kind: OrganisationKind,
  id: string,
): Promise<boolean> {
  const config = KINDS[kind];
  const db = await getAuthDb();
  const deleted = await db
    .prepare(
      `DELETE FROM ${config.table} WHERE userId = ? AND id = ? RETURNING id`,
    )
    .bind(userId, id)
    .first<{ id: string }>();
  return Boolean(deleted);
}

/** Add or remove one authority's membership of one group. */
export async function setMembership(
  userId: string,
  kind: OrganisationKind,
  groupId: string,
  authorityId: string,
  member: boolean,
): Promise<boolean> {
  const config = KINDS[kind];
  const db = await getAuthDb();
  if (!member) {
    const removed = await db
      .prepare(`DELETE FROM ${config.members}
        WHERE userId = ? AND ${config.memberKey} = ? AND authorityId = ?
        RETURNING authorityId`)
      .bind(userId, groupId, authorityId)
      .first<{ authorityId: string }>();
    return Boolean(removed);
  }
  // Both foreign keys are owner-bound, so a borrowed group id or authority id
  // fails here rather than crossing accounts.
  const added = await db
    .prepare(`INSERT OR IGNORE INTO ${config.members}
        (userId, ${config.memberKey}, authorityId, addedAt)
      SELECT ?, ?, a.id, ? FROM saved_authorities a
      WHERE a.userId = ? AND a.id = ?
        AND EXISTS (SELECT 1 FROM ${config.table} g
          WHERE g.userId = ? AND g.id = ?)
      RETURNING authorityId`)
    .bind(userId, groupId, Date.now(), userId, authorityId, userId, groupId)
    .first<{ authorityId: string }>();
  return Boolean(added);
}

/** Which groups of both kinds one authority belongs to. */
export async function membershipsFor(
  userId: string,
  authorityId: string,
): Promise<{ tags: string[]; collections: string[] }> {
  const db = await getAuthDb();
  const [tags, collections] = await db.batch<{ id: string }>([
    db
      .prepare(`SELECT tagId AS id FROM research_tag_members
        WHERE userId = ? AND authorityId = ?`)
      .bind(userId, authorityId),
    db
      .prepare(`SELECT collectionId AS id FROM research_collection_members
        WHERE userId = ? AND authorityId = ?`)
      .bind(userId, authorityId),
  ]);
  return {
    tags: (tags.results ?? []).map((row) => row.id),
    collections: (collections.results ?? []).map((row) => row.id),
  };
}
