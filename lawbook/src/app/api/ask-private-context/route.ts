import {
  buildManifest,
  normalizeConsent,
  redactForLogs,
  toContextBlocks,
} from "@/lib/ask-consent";
import { loadConsentedContext } from "@/lib/ask-private-context";
import { getSession } from "@/lib/auth";
import { privateJson, privateRoute } from "@/lib/private-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Preview and assemble consented private context for Ask (#200).
 *
 * POST with `preview: true` returns the manifest the reader must see before
 * anything is sent. POST without it returns provenance-tagged context blocks ready
 * to be included in a request.
 *
 * Nothing here is persisted. There is no consent record, no draft, and no stored
 * preference: consent is per request, so abandoning the flow leaves no trace and
 * changes no default. Only the redacted summary — counts and refs, never a word the
 * reader wrote — is suitable for logging.
 */
export async function POST(req: Request): Promise<Response> {
  return privateRoute(async () => {
    const session = await getSession(req.headers);
    if (!session)
      return privateJson({ error: "Authentication required" }, { status: 401 });
    const body = (await req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;

    // Fails closed: anything malformed becomes "no consent", which yields an
    // empty manifest rather than an error that might tempt a retry with defaults.
    const consent = normalizeConsent(body?.consent);
    if (!consent.includePrivateNotes)
      return privateJson({
        manifest: buildManifest([], consent),
        blocks: [],
        includedNothing: true,
        reason:
          "Your notes are not included. Turn on “Include my private notes” and choose which passages to use.",
      });

    // Authorization is rechecked here against the session, so a borrowed id in
    // the request simply does not come back from the query.
    const { items, urls } = await loadConsentedContext(
      session.user.id,
      consent,
    );
    const manifest = buildManifest(items, consent);

    if (body?.preview === true) return privateJson({ manifest });

    const blocks = toContextBlocks(items, consent, urls);
    return privateJson({
      manifest,
      blocks,
      // What a caller may safely record about this request.
      logSummary: redactForLogs(blocks),
    });
  });
}
