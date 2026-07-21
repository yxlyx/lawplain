import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  ApiKeyStore,
  type ApiKeySummary,
  type CreateApiKeyResult,
} from "@/lib/api-key-store";

interface ApiKeysEnv extends CloudflareEnv {
  AUTH_DB?: D1Database;
}

export {
  ApiKeyStore,
  type ApiKeySummary,
  type CreateApiKeyResult,
  MAX_ACTIVE_API_KEYS,
} from "@/lib/api-key-store";

async function getStore(): Promise<ApiKeyStore> {
  const { env } = await getCloudflareContext({ async: true });
  const db = (env as ApiKeysEnv).AUTH_DB;
  if (!db) {
    throw new Error(
      "Missing Cloudflare D1 binding AUTH_DB. Apply migrations before using API keys.",
    );
  }
  return new ApiKeyStore(db);
}

export async function listApiKeys(userId: string): Promise<ApiKeySummary[]> {
  return (await getStore()).list(userId);
}

export async function createApiKey(
  userId: string,
  name: string,
): Promise<CreateApiKeyResult> {
  return (await getStore()).create(userId, name);
}

export async function revokeApiKey(
  userId: string,
  id: string,
): Promise<boolean> {
  return (await getStore()).revoke(userId, id);
}

export async function validateApiKey(
  rawKey: string,
): Promise<{ id: string; userId: string } | null> {
  return (await getStore()).validate(rawKey);
}

export async function touchApiKey(id: string): Promise<void> {
  await (await getStore()).touch(id);
}
