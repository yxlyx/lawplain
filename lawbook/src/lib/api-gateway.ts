import { isApiKeyFormat, readBearerApiKey } from "./api-key-auth.ts";

const CREDENTIAL_QUERY_NAMES = new Set([
  "apikey",
  "accesstoken",
  "token",
  "key",
  "authorization",
  "auth",
  "credential",
  "credentials",
  "bearertoken",
]);

/** Reject credentials in URLs before they can be forwarded to the upstream. */
export function hasApiCredentialQuery(searchParams: URLSearchParams): boolean {
  for (const [name, value] of searchParams) {
    const normalizedName = name.toLowerCase().replaceAll(/[-_]/g, "");
    const bearerValue = readBearerApiKey(value);
    if (
      CREDENTIAL_QUERY_NAMES.has(normalizedName) ||
      isApiKeyFormat(value) ||
      (bearerValue !== null && isApiKeyFormat(bearerValue))
    ) {
      return true;
    }
  }
  return false;
}

/** Fetch forbids bodies, including empty strings, for these response statuses. */
export function proxyResponseBody(
  status: number,
  bodyText: string,
): string | null {
  return status === 204 || status === 205 || status === 304 ? null : bodyText;
}
