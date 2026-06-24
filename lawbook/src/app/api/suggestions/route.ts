/**
 * GET /api/suggestions?docType=&docId=&term=
 *
 * Returns aggregate "suggested sections" for a search term within a document:
 * the most-engaged sections, ranked by count, gated behind a minimum sample
 * size (see MIN_SAMPLE in @/lib/suggestions). Aggregate-only and public read —
 * no auth required, and individual engagement events are never exposed.
 *
 * Response: { total: number, sections: { sectionId, count }[] }
 *   - Below threshold: sections is [] (real `total` still reported).
 *   - At/above threshold: top-N sections by count desc.
 *
 * Cacheable: the response carries `Cache-Control: s-maxage=300,
 * stale-while-revalidate=600` so the CDN can serve it from cache (~5min).
 */
import { getSuggestions } from "@/lib/suggestions";

// Default (static-eligible) segment config. We deliberately do NOT set
// `dynamic = "force-dynamic"`: that flag forces `no-store` semantics and would
// strip our Cache-Control header, defeating CDN caching. Reading the query
// string off `req.url` is allowed without opting into the dynamic runtime, so
// the handler still sees per-request params while remaining cacheable.
export const runtime = "nodejs";
export const dynamic = "auto";

const MAX_LEN = 256;
const VALID_DOC_TYPES = new Set(["judgment", "statute"]);
const CACHE_HEADERS = {
  "Cache-Control": "s-maxage=300, stale-while-revalidate=600",
};

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);

  const docType = searchParams.get("docType")?.trim() ?? "";
  const docId = searchParams.get("docId")?.trim() ?? "";
  const term = (searchParams.get("term") ?? "").trim().toLowerCase();

  if (!VALID_DOC_TYPES.has(docType)) {
    return Response.json(
      { error: "docType must be 'judgment' or 'statute'" },
      { status: 400 },
    );
  }
  if (!docId || docId.length > MAX_LEN) {
    return Response.json(
      { error: "docId must be a non-empty string of at most 256 characters" },
      { status: 400 },
    );
  }
  if (!term || term.length > MAX_LEN) {
    return Response.json(
      { error: "term must be a non-empty string of at most 256 characters" },
      { status: 400 },
    );
  }

  try {
    const { total, sections } = await getSuggestions({ docType, docId, term });
    return Response.json({ total, sections }, { headers: CACHE_HEADERS });
  } catch {
    // Graceful degradation: a missing D1 binding or a transient backend error
    // should not break the reading UI. Return an empty aggregate so the client
    // simply renders no suggestions instead of an error state.
    return Response.json(
      { total: 0, sections: [] },
      { headers: CACHE_HEADERS },
    );
  }
}
