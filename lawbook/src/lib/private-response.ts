export const PRIVATE_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
} as const;

export function privateJson(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(PRIVATE_RESPONSE_HEADERS))
    headers.set(name, value);
  return Response.json(body, { ...init, headers });
}

export async function privateRoute(
  action: () => Promise<Response>,
): Promise<Response> {
  try {
    return await action();
  } catch {
    // Private payloads and query terms must not enter ordinary application logs.
    return privateJson(
      { error: "Could not complete the private request" },
      { status: 500 },
    );
  }
}
