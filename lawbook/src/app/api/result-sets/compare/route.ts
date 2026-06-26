import { getSession } from "@/lib/auth";
import {
  compareResultSnapshots,
  getSavedResultSet,
} from "@/lib/saved-result-sets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const session = await getSession(req.headers);
  if (!session) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const url = new URL(req.url);
  const a = url.searchParams.get("a");
  const b = url.searchParams.get("b");
  if (!a || !b || a === b) {
    return Response.json(
      { error: "Two different result set ids are required" },
      { status: 400 },
    );
  }

  const [left, right] = await Promise.all([
    getSavedResultSet({ userId: session.user.id, id: a }),
    getSavedResultSet({ userId: session.user.id, id: b }),
  ]);
  if (!left || !right) {
    return Response.json({ error: "Result set not found" }, { status: 404 });
  }

  return Response.json({
    left,
    right,
    comparison: compareResultSnapshots(left.results, right.results),
  });
}
