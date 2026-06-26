import { getAuthDb } from "@/lib/d1";
import {
  parseSectionEngagementEvent,
  recordSectionEngagement,
} from "@/lib/engagement";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(null, { status: 204 });
  }

  const event = parseSectionEngagementEvent(body);
  if (!event) return new Response(null, { status: 204 });

  try {
    const db = await getAuthDb();
    await recordSectionEngagement({ db, req, event });
  } catch (err) {
    console.error("section engagement write failed", err);
  }

  return new Response(null, { status: 204 });
}
