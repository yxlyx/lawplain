import { getSession } from "@/lib/auth";
import { privateJson, privateRoute } from "@/lib/private-response";
import {
  createGroup,
  isOrganisationKind,
  listGroups,
  normalizeDescription,
  normalizeGroupName,
} from "@/lib/research-organisation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return privateRoute(async () => {
    const session = await getSession(req.headers);
    if (!session)
      return privateJson({ error: "Authentication required" }, { status: 401 });
    const kind = new URL(req.url).searchParams.get("kind");
    if (!isOrganisationKind(kind))
      return privateJson({ error: "Invalid kind" }, { status: 400 });
    return privateJson({ groups: await listGroups(session.user.id, kind) });
  });
}

export async function POST(req: Request): Promise<Response> {
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
    const name = normalizeGroupName(body.name, body.kind);
    if (!name)
      return privateJson(
        { error: `Give this ${body.kind} a name` },
        { status: 400 },
      );
    const description = normalizeDescription(body.description);
    if (description === undefined)
      return privateJson({ error: "Description is too long" }, { status: 400 });
    try {
      // Creating an existing name joins it rather than failing, so an inline
      // create while saving cannot produce a duplicate.
      const group = await createGroup(
        session.user.id,
        body.kind,
        name,
        description,
      );
      if (!group)
        return privateJson({ error: "Could not create it" }, { status: 500 });
      return privateJson({ group }, { status: 201 });
    } catch (error) {
      if (error instanceof Error && error.message === "GROUP_LIMIT")
        return privateJson(
          {
            error: `You have reached the limit for ${body.kind}s. Merge or delete some first.`,
          },
          { status: 409 },
        );
      throw error;
    }
  });
}
