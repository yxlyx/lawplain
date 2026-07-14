import { getCloudflareContext } from "@opennextjs/cloudflare";

export async function getAuthDb(): Promise<D1Database> {
  const { env } = await getCloudflareContext({ async: true });
  const db = (env as CloudflareEnv).AUTH_DB;
  if (!db) {
    throw new Error(
      "Missing Cloudflare D1 binding AUTH_DB. Run through the Cloudflare preview/dev runtime and apply D1 migrations.",
    );
  }
  return db;
}

export async function getTrajectoryDb(): Promise<D1Database> {
  const { env } = await getCloudflareContext({ async: true });
  const db = (env as CloudflareEnv).TRAJECTORY_DB;
  if (!db) {
    throw new Error(
      "Missing Cloudflare D1 binding TRAJECTORY_DB. Apply trajectory migrations before recording Ask feedback.",
    );
  }
  return db;
}
