import { listAskQuestions } from "@/lib/ask-history";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const session = await getSession(req.headers);
  if (!session) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const questions = await listAskQuestions({ userId: session.user.id });

  return Response.json({ questions });
}
