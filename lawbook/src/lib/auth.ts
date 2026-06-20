import { getCloudflareContext } from "@opennextjs/cloudflare";
import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins/username";

interface AuthEnv extends CloudflareEnv {
  AUTH_DB?: D1Database;
}

export async function getAuth() {
  const { env } = await getCloudflareContext({ async: true });
  const authDb = (env as AuthEnv).AUTH_DB;

  if (!authDb) {
    throw new Error(
      "Missing Cloudflare D1 binding AUTH_DB. Create the D1 database and configure wrangler.jsonc before using auth.",
    );
  }

  return betterAuth({
    appName: "Lawplain",
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    database: authDb,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    plugins: [username()],
  });
}

export async function getSession(headers: Headers) {
  const auth = await getAuth();
  return auth.api.getSession({ headers });
}
