import { getSession } from "@/lib/auth";
import { privateJson, privateRoute } from "@/lib/private-response";
import {
  isOrganisationKind,
  membershipsFor,
  setMembership,
} from "@/lib/research-organisation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return privateRoute(async () => {
    const session = await getSession(req.headers);
    if (!session)
      return privateJson({ error: "Authentication required" }, { status: 401 });
    const authorityId = new URL(req.url).searchParams.get("authorityId");
    if (!authorityId)
      return privateJson({ error: "Invalid authority" }, { status: 400 });
    return privateJson(await membershipsFor(session.user.id, authorityId));
  });
}

export async function PUT(req: Request): Promise<Response> {
  return privateRoute(async () => {
    const session = await getSession(req.headers);
    if (!session)
      return privateJson({ error: "Authentication required" }, { status: 401 });
    const body = (await req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || !isOrganisationKind(body.kind))
      return privateJson({ error: "Invalid kind" }, { status: 400 });
    if (
      typeof body.groupId !== "string" ||
      typeof body.authorityId !== "string" ||
      typeof body.member !== "boolean"
    )
      return privateJson({ error: "Invalid membership" }, { status: 400 });
    const changed = await setMembership(
      session.user.id,
      body.kind,
      body.groupId,
      body.authorityId,
      body.member,
    );
    // A borrowed group or authority id resolves to nothing here, because both
    // sides of the membership are owner-bound in SQL.
    if (!changed && body.member)
      return privateJson(
        { error: "Could not add it — check the document and the group" },
        { status: 404 },
      );
    return privateJson({ member: body.member });
  });
}
