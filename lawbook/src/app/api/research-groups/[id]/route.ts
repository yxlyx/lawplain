import { getSession } from "@/lib/auth";
import { privateJson, privateRoute } from "@/lib/private-response";
import {
  deleteGroup,
  isOrganisationKind,
  mergeGroups,
  normalizeDescription,
  normalizeGroupName,
  updateGroup,
} from "@/lib/research-organisation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(
  req: Request,
  { params }: Params,
): Promise<Response> {
  return privateRoute(async () => {
    const session = await getSession(req.headers);
    if (!session)
      return privateJson({ error: "Authentication required" }, { status: 401 });
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || !isOrganisationKind(body.kind))
      return privateJson({ error: "Invalid kind" }, { status: 400 });

    // Merging moves memberships and removes the source; the authorities and their
    // annotations are untouched either way.
    if (typeof body.mergeInto === "string") {
      const merged = await mergeGroups(
        session.user.id,
        body.kind,
        id,
        body.mergeInto,
      );
      if (!merged)
        return privateJson(
          { error: "Could not merge into that one" },
          { status: 404 },
        );
      return privateJson({ merged: true });
    }

    const changes: {
      name?: string;
      description?: string | null;
      archived?: boolean;
    } = {};
    if (body.name !== undefined) {
      const name = normalizeGroupName(body.name, body.kind);
      if (!name) return privateJson({ error: "Invalid name" }, { status: 400 });
      changes.name = name;
    }
    if (body.description !== undefined) {
      const description = normalizeDescription(body.description);
      if (description === undefined)
        return privateJson(
          { error: "Description is too long" },
          { status: 400 },
        );
      changes.description = description;
    }
    if (body.archived !== undefined) {
      if (typeof body.archived !== "boolean")
        return privateJson({ error: "Invalid archived" }, { status: 400 });
      changes.archived = body.archived;
    }
    if (Object.keys(changes).length === 0)
      return privateJson({ error: "Nothing to change" }, { status: 400 });

    try {
      const group = await updateGroup(session.user.id, body.kind, id, changes);
      if (!group) return privateJson({ error: "Not found" }, { status: 404 });
      return privateJson({ group });
    } catch (error) {
      // The owner-scoped unique index is what rejects a duplicate rename.
      if (error instanceof Error && /UNIQUE|constraint/i.test(error.message))
        return privateJson(
          { error: "You already have one with that name" },
          { status: 409 },
        );
      throw error;
    }
  });
}

export async function DELETE(
  req: Request,
  { params }: Params,
): Promise<Response> {
  return privateRoute(async () => {
    const session = await getSession(req.headers);
    if (!session)
      return privateJson({ error: "Authentication required" }, { status: 401 });
    const { id } = await params;
    const kind = new URL(req.url).searchParams.get("kind");
    if (!isOrganisationKind(kind))
      return privateJson({ error: "Invalid kind" }, { status: 400 });
    const deleted = await deleteGroup(session.user.id, kind, id);
    if (!deleted) return privateJson({ error: "Not found" }, { status: 404 });
    // Said plainly, because a reader deleting a tag needs to know their documents
    // and highlights are still there.
    return privateJson({
      deleted: true,
      keptDocuments: true,
      keptAnnotations: true,
    });
  });
}
