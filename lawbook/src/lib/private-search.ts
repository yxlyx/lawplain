/**
 * Private research search (#196) — D1 wrapper around private-search-query.ts.
 *
 * The query itself is pure and lives next door so it can be executed in tests.
 */
import { getAuthDb } from "@/lib/d1";
import {
  buildPrivateSearchQuery,
  type PrivateSearchOptions,
  toPrivateSearchPage,
} from "@/lib/private-search-query";

export type {
  MatchField,
  PrivateSearchHit,
  PrivateSearchOptions,
} from "@/lib/private-search-query";
export {
  MAX_QUERY_LENGTH,
  normalizeSearchQuery,
} from "@/lib/private-search-query";

export async function searchPrivateResearch(
  userId: string,
  options: PrivateSearchOptions,
) {
  const built = buildPrivateSearchQuery(userId, options);
  const db = await getAuthDb();
  const result = await db
    .prepare(built.sql)
    .bind(...built.params)
    .all();
  return toPrivateSearchPage(
    (result.results ?? []) as unknown as Parameters<
      typeof toPrivateSearchPage
    >[0],
    { limit: built.limit, shape: built.shape, userId, q: options.q },
  );
}
