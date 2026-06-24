/**
 * POST /api/events — anonymous, counter-only engagement sink.
 *
 * Body: { kind:'section_engage', docType:'judgment'|'statute', docId, term, sectionId }
 *
 * Privacy posture (see docs/suggested-sections.md):
 *  - No identifiers, no PII. We only increment aggregate counters.
 *  - Consent + Do-Not-Track are enforced on the client before engagement beacons
 *    fire.
 *
 * The endpoint is intentionally silent: every outcome (accept, validation
 * reject, rate-limit, backend error) returns `204 No Content`, so a caller can
 * never probe it for state and rendering is never blocked on the result.
 */
import {
  checkRateLimit,
  type DocType,
  recordEngagement,
} from "@/lib/engagement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LEN = 256;
const VALID_DOC_TYPES = new Set<DocType>(["judgment", "statute"]);

// One shared, body-less 204 for every code path.
const NO_CONTENT = () => new Response(null, { status: 204 });

interface EventBody {
  kind?: unknown;
  docType?: unknown;
  docId?: unknown;
  term?: unknown;
  sectionId?: unknown;
}

function validString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_LEN) return null;
  return trimmed;
}

async function withinRateLimit(req: Request): Promise<boolean> {
  const ip =
    req.headers.get("CF-Connecting-IP") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";

  try {
    return await checkRateLimit(ip);
  } catch {
    // Rate-limit backend hiccup: fail open; event writes are best-effort.
    return true;
  }
}

export async function POST(req: Request): Promise<Response> {
  let body: EventBody;
  try {
    body = (await req.json()) as EventBody;
  } catch {
    return NO_CONTENT();
  }

  if (body.kind !== "section_engage") return NO_CONTENT();

  if (!(await withinRateLimit(req))) return NO_CONTENT();

  const docType = body.docType;
  if (typeof docType !== "string" || !VALID_DOC_TYPES.has(docType as DocType)) {
    return NO_CONTENT();
  }

  const docId = validString(body.docId);
  const sectionId = validString(body.sectionId);
  const termRaw = validString(body.term);
  if (!docId || !sectionId || !termRaw) return NO_CONTENT();

  try {
    await recordEngagement({
      docType: docType as DocType,
      docId,
      sectionId,
      term: termRaw.toLowerCase(),
    });
  } catch {
    // Counter store unavailable — swallow; logging is best-effort.
  }

  return NO_CONTENT();
}
