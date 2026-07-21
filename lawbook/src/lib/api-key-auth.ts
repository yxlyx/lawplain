export const API_KEY_PREFIX = "lp_live_";
export const API_KEY_RANDOM_BYTES = 24;
export const API_KEY_VISIBLE_PREFIX_LENGTH = 12;
export const DEFAULT_API_KEY_NAME = "API key";
export const MAX_API_KEY_NAME_LENGTH = 80;

const API_KEY_PATTERN = new RegExp(
  `^${API_KEY_PREFIX}[0-9a-f]{${API_KEY_RANDOM_BYTES * 2}}$`,
);

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Generate a high-entropy key whose plaintext is only returned at creation. */
export function generateRawApiKey(): string {
  return `${API_KEY_PREFIX}${toHex(
    crypto.getRandomValues(new Uint8Array(API_KEY_RANDOM_BYTES)),
  )}`;
}

/** Hash keys before persistence so a database leak does not expose credentials. */
export async function hashApiKey(rawKey: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(rawKey),
  );
  return toHex(new Uint8Array(digest));
}

/** Reject malformed credentials before performing a database lookup. */
export function isApiKeyFormat(rawKey: string): boolean {
  return API_KEY_PATTERN.test(rawKey);
}

/**
 * Read a Bearer credential without accepting query-string fallbacks, which can
 * leak secrets through browser history, access logs, referrers, and analytics.
 */
export function readBearerApiKey(authorization: string | null): string | null {
  if (!authorization) return null;
  const match = /^Bearer[\t ]+([^\s,]+)[\t ]*$/i.exec(authorization);
  return match?.[1] ?? null;
}

export function normalizeApiKeyName(name: string): string {
  return name.trim().slice(0, MAX_API_KEY_NAME_LENGTH) || DEFAULT_API_KEY_NAME;
}
