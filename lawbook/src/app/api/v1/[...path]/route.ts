/**
 * GET /api/v1/* — the public, API-key-authenticated Lawplain endpoint.
 *
 * Mirrors the sgjudge corpus API (`backend.lawplain.com/v1/*`) but gated by a
 * personal API key so a user's own agents/scripts can call it:
 *
 *   curl -H "Authorization: Bearer lp_live_…" \
 *     "https://lawplain.com/api/v1/judgments/search?q=negligence"
 *
 * The key is validated against the hashed store in D1; the request is then
 * proxied to the corpus backend. Read-only (GET) — same surface as the app.
 */
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { touchApiKey, validateApiKey } from "@/lib/api-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND = "https://backend.lawplain.com";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
} as const;

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8" },
  });
}

export function OPTIONS(): Response {
  return new Response(null, { headers: CORS });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  const url = new URL(req.url);
  const rawKey = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : (url.searchParams.get("api_key") ?? "");

  const identity = await validateApiKey(rawKey);
  if (!identity) {
    return json(
      {
        error:
          "Invalid or missing API key. Pass it as 'Authorization: Bearer lp_live_…'. Create one at /developers.",
      },
      401,
    );
  }

  const { path } = await params;
  const segments = (path ?? []).map(encodeURIComponent).join("/");
  url.searchParams.delete("api_key");
  const target = `${BACKEND}/v1/${segments}${url.search}`;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return json({ error: "Upstream corpus API is unavailable." }, 502);
  }

  // Record usage without delaying the response.
  try {
    const { ctx } = await getCloudflareContext({ async: true });
    ctx.waitUntil(touchApiKey(identity.id).catch(() => {}));
  } catch {
    // best-effort usage accounting
  }

  const bodyText = await upstream.text();
  return new Response(bodyText, {
    status: upstream.status,
    headers: {
      ...CORS,
      "content-type":
        upstream.headers.get("content-type") ?? "application/json",
      // Mirror the backend's edge-cache hint so clients/CDN can cache reads.
      "cache-control": upstream.headers.get("cache-control") ?? "no-store",
    },
  });
}
