import { getSession } from "@/lib/auth";
import {
  isCitationFormat,
  listCitationFormatUsage,
  recordCitationFormatUsage,
} from "@/lib/citation-format-usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const session = await getSession(req.headers);
  if (!session) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const usage = await listCitationFormatUsage(session.user.id);
  return Response.json({ usage });
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

  if (!body || !isCitationFormat(body.format)) {
    return Response.json({ error: "Invalid citation format" }, { status: 400 });
  }

  await recordCitationFormatUsage({
    userId: session.user.id,
    format: body.format,
  });
  const usage = await listCitationFormatUsage(session.user.id);

  return Response.json({ usage }, { status: 201 });
}
