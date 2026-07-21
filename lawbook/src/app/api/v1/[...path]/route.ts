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
import { hasApiCredentialQuery, proxyResponseBody } from "@/lib/api-gateway";
import { readBearerApiKey } from "@/lib/api-key-auth";
import { touchApiKey, validateApiKey } from "@/lib/api-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BACKEND = "https://backend.lawplain.com";

const API_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
  "cache-control": "private, no-store",
  vary: "Authorization",
  "x-content-type-options": "nosniff",
} as const;

function json(
  data: unknown,
  status: number,
  headers: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...API_HEADERS,
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

type RateLimitDecision = "allowed" | "limited" | "unavailable";

async function consumeRateLimit(key: string): Promise<RateLimitDecision> {
  let limiter: RateLimit | undefined;
  try {
    const { env } = await getCloudflareContext({ async: true });
    limiter = (env as CloudflareEnv).API_RATE_LIMITER;
  } catch {
    // The binding is absent in local Next.js development and unit tests.
    return "allowed";
  }
  if (!limiter) return "allowed";

  try {
    const result = await limiter.limit({ key });
    return result.success ? "allowed" : "limited";
  } catch {
    return "unavailable";
  }
}

function rateLimitResponse(decision: RateLimitDecision): Response | null {
  if (decision === "limited") {
    return json({ error: "API rate limit exceeded." }, 429, {
      "retry-after": "60",
    });
  }
  if (decision === "unavailable") {
    return json(
      { error: "API rate limiting is temporarily unavailable." },
      503,
    );
  }
  return null;
}

export function OPTIONS(): Response {
  return new Response(null, { headers: API_HEADERS });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const clientIp = req.headers.get("cf-connecting-ip") ?? "unknown";
  const preAuthLimit = rateLimitResponse(
    await consumeRateLimit(`api-ip:${clientIp}`),
  );
  if (preAuthLimit) return preAuthLimit;

  const rawKey = readBearerApiKey(req.headers.get("authorization"));
  if (!rawKey) {
    return json(
      {
        error:
          "Invalid or missing API key. Pass it as 'Authorization: Bearer lp_live_…'. Create one at /developers.",
      },
      401,
    );
  }

  let identity: Awaited<ReturnType<typeof validateApiKey>>;
  try {
    identity = await validateApiKey(rawKey);
  } catch {
    return json(
      { error: "API key validation is temporarily unavailable." },
      503,
    );
  }
  if (!identity) {
    return json(
      {
        error:
          "Invalid or missing API key. Pass it as 'Authorization: Bearer lp_live_…'. Create one at /developers.",
      },
      401,
    );
  }

  const accountLimit = rateLimitResponse(
    await consumeRateLimit(`api-user:${identity.userId}`),
  );
  if (accountLimit) return accountLimit;

  // Count every successfully authenticated request, including upstream errors.
  // Never await this bookkeeping on the request's critical path.
  try {
    const { ctx } = await getCloudflareContext({ async: true });
    ctx.waitUntil(touchApiKey(identity.id).catch(() => {}));
  } catch {
    // Best-effort usage accounting outside the Workers runtime.
  }

  const url = new URL(req.url);
  if (hasApiCredentialQuery(url.searchParams)) {
    return json(
      {
        error: "API credentials must only be sent in the Authorization header.",
      },
      400,
    );
  }

  const { path } = await params;
  const segments = (path ?? []).map(encodeURIComponent).join("/");
  const target = `${BACKEND}/v1/${segments}${url.search}`;

  let upstream: Response;
  let bodyText: string;
  try {
    upstream = await fetch(target, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    bodyText = await upstream.text();
  } catch {
    return json({ error: "Upstream corpus API is unavailable." }, 502);
  }

  return new Response(proxyResponseBody(upstream.status, bodyText), {
    status: upstream.status,
    headers: {
      ...API_HEADERS,
      "content-type":
        upstream.headers.get("content-type") ?? "application/json",
    },
  });
}
