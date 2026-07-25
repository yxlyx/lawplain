import { getSession } from "@/lib/auth";
import {
  deleteFollowUp,
  listFollowUps,
  normalizeFollowUpChanges,
  setFollowUp,
} from "@/lib/follow-ups";
import { privateJson, privateRoute } from "@/lib/private-response";
import { isSavedDocType } from "@/lib/saved-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATES = ["open", "resolved", "all"] as const;
type State = (typeof STATES)[number];

function isState(value: string | null): value is State {
  return STATES.includes(value as State);
}

export async function GET(req: Request): Promise<Response> {
  return privateRoute(async () => {
    const session = await getSession(req.headers);
    if (!session)
      return privateJson({ error: "Authentication required" }, { status: 401 });
    const params = new URL(req.url).searchParams;
    const rawState = params.get("state");
    if (rawState !== null && !isState(rawState))
      return privateJson({ error: "Invalid state" }, { status: 400 });
    const rawType = params.get("docType");
    if (rawType !== null && !isSavedDocType(rawType))
      return privateJson({ error: "Invalid document type" }, { status: 400 });
    return privateJson({
      followUps: await listFollowUps(session.user.id, {
        state: rawState ?? undefined,
        docType: rawType ?? undefined,
        docId: params.get("docId") ?? undefined,
      }),
    });
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
    if (!body || typeof body.annotationId !== "string")
      return privateJson({ error: "Invalid annotation" }, { status: 400 });
    const changes = normalizeFollowUpChanges(body);
    if (!changes)
      return privateJson({ error: "Nothing to change" }, { status: 400 });
    const followUp = await setFollowUp(
      session.user.id,
      body.annotationId,
      changes,
    );
    // A borrowed annotation id matches nothing, because the write is bound to an
    // annotation this owner has.
    if (!followUp)
      return privateJson(
        { error: "That passage is not in your research" },
        { status: 404 },
      );
    return privateJson({ followUp });
  });
}

export async function DELETE(req: Request): Promise<Response> {
  return privateRoute(async () => {
    const session = await getSession(req.headers);
    if (!session)
      return privateJson({ error: "Authentication required" }, { status: 401 });
    const annotationId = new URL(req.url).searchParams.get("annotationId");
    if (!annotationId)
      return privateJson({ error: "Invalid annotation" }, { status: 400 });
    const deleted = await deleteFollowUp(session.user.id, annotationId);
    if (!deleted)
      return privateJson({ error: "No follow-up to remove" }, { status: 404 });
    // The highlight and its note are untouched; say so.
    return privateJson({ deleted: true, keptAnnotation: true });
  });
}
