import { getSession } from "@/lib/auth";
import { listLibrary } from "@/lib/private-annotations";
import { privateJson, privateRoute } from "@/lib/private-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return privateRoute(async () => {
    const session = await getSession(req.headers);
    if (!session)
      return privateJson({ error: "Authentication required" }, { status: 401 });
    const params = new URL(req.url).searchParams;
    const rawLimit = params.get("limit");
    const limit = rawLimit === null ? undefined : Number(rawLimit);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1))
      return privateJson({ error: "Invalid limit" }, { status: 400 });
    try {
      return privateJson(
        await listLibrary(session.user.id, limit, params.get("cursor")),
      );
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_CURSOR")
        return privateJson({ error: "Invalid cursor" }, { status: 400 });
      throw error;
    }
  });
}
