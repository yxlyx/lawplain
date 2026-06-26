import { getSession } from "@/lib/auth";
import {
  clearSearchHistory,
  isSearchTab,
  listSearchHistory,
  normalizeResultSnapshot,
  normalizeSearchFilters,
  normalizeSearchQuery,
  recordSearchHistory,
} from "@/lib/search-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const session = await getSession(req.headers);
  if (!session)
    return Response.json({ error: "Authentication required" }, { status: 401 });

  const url = new URL(req.url);
  const tabParam = url.searchParams.get("tab");
  if (tabParam && !isSearchTab(tabParam)) {
    return Response.json({ error: "Invalid tab" }, { status: 400 });
  }
  const tab = tabParam && isSearchTab(tabParam) ? tabParam : undefined;

  const searches = await listSearchHistory({
    userId: session.user.id,
    tab,
    limit: parseLimit(url.searchParams.get("limit")),
  });
  return Response.json({ searches });
}

export async function POST(req: Request): Promise<Response> {
  const session = await getSession(req.headers);
  if (!session)
    return Response.json({ error: "Authentication required" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) return Response.json({ error: "Invalid JSON" }, { status: 400 });
  if (!isSearchTab(body.tab))
    return Response.json({ error: "Invalid tab" }, { status: 400 });

  const query = normalizeSearchQuery(body.query);
  if (!query)
    return Response.json(
      { error: "Search query is required" },
      { status: 400 },
    );

  await recordSearchHistory({
    userId: session.user.id,
    tab: body.tab,
    query,
    filters: normalizeSearchFilters(body.filters),
    resultCount: typeof body.resultCount === "number" ? body.resultCount : 0,
    topResults: normalizeResultSnapshot(body.topResults, { limit: 10 }),
  });

  return Response.json({ ok: true }, { status: 201 });
}

export async function DELETE(req: Request): Promise<Response> {
  const session = await getSession(req.headers);
  if (!session)
    return Response.json({ error: "Authentication required" }, { status: 401 });
  await clearSearchHistory({ userId: session.user.id });
  return Response.json({ ok: true });
}

function parseLimit(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
