import { getSession } from "@/lib/auth";
import { getTrajectoryDb } from "@/lib/d1";
import {
  listTrajectoryRatings,
  setTrajectoryFeedbackReason,
  setTrajectoryRating,
  type TrajectoryRating,
} from "@/server/trajectory-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parseRating(value: unknown): TrajectoryRating | null | undefined {
  if (value === null) return null;
  if (value === "helpful" || value === "not_helpful") return value;
  return undefined;
}

function parseReason(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const reason = value.trim();
  if (!reason) return null;
  return reason.length <= 1000 ? reason : undefined;
}

export async function GET(req: Request): Promise<Response> {
  const session = await getSession(req.headers);
  if (!session) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const threadId = clean(new URL(req.url).searchParams.get("threadId"), 100);
  if (!threadId) {
    return Response.json({ error: "Missing thread id" }, { status: 400 });
  }

  const ratings = await listTrajectoryRatings(
    await getTrajectoryDb(),
    session.user.id,
    threadId,
  );
  return Response.json({ ratings });
}

export async function POST(req: Request): Promise<Response> {
  const session = await getSession(req.headers);
  if (!session) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const runId = clean(body?.runId, 100);
  const rating = parseRating(body?.rating);
  if (!runId || rating === undefined) {
    return Response.json({ error: "Invalid feedback" }, { status: 400 });
  }

  const saved = await setTrajectoryRating(await getTrajectoryDb(), {
    runId,
    userId: session.user.id,
    rating,
  });
  if (!saved) {
    return Response.json(
      { error: "Completed answer not found" },
      { status: 404 },
    );
  }

  return Response.json({ feedback: saved });
}

export async function PATCH(req: Request): Promise<Response> {
  const session = await getSession(req.headers);
  if (!session) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const runId = clean(body?.runId, 100);
  const reason = parseReason(body?.reason);
  if (!runId || reason === undefined) {
    return Response.json({ error: "Invalid feedback reason" }, { status: 400 });
  }

  const saved = await setTrajectoryFeedbackReason(await getTrajectoryDb(), {
    runId,
    userId: session.user.id,
    reason,
  });
  if (!saved) {
    return Response.json(
      { error: "Negative rating not found" },
      { status: 404 },
    );
  }

  return Response.json({ feedback: saved });
}
