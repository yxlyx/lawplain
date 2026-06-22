import { getCloudflareContext } from "@opennextjs/cloudflare";
import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins/username";

interface AuthEnv extends CloudflareEnv {
  AUTH_DB?: D1Database;
}

function getTrustedOrigins() {
  return Array.from(
    new Set(
      [
        process.env.BETTER_AUTH_URL,
        ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "")
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean),
        ...(process.env.NODE_ENV === "development"
          ? [
              "http://localhost:3000",
              "http://localhost:3001",
              "http://localhost:3002",
              "http://127.0.0.1:3000",
              "http://127.0.0.1:3001",
              "http://127.0.0.1:3002",
            ]
          : []),
      ].filter((origin): origin is string => Boolean(origin)),
    ),
  );
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
    trustedOrigins: getTrustedOrigins(),
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
