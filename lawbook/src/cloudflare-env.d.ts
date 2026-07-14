/// <reference types="@cloudflare/workers-types" />

declare global {
  interface CloudflareEnv {
    AUTH_DB?: D1Database;
    TRAJECTORY_DB?: D1Database;
    ASK_RUN_DO?: DurableObjectNamespace;
    BETTER_AUTH_SECRET?: string;
    BETTER_AUTH_TRUSTED_ORIGINS?: string;
    BETTER_AUTH_URL?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    LAWPLAIN_ASK_AGENT_ENABLED?: string;
    LAWPLAIN_PUBLIC_HOST?: string;
    LAWPLAIN_AGENT_CREDENTIAL?: string;
    CODEGRAFF_API_KEY?: string;
    CUBESANDBOX_GATEWAY_URL?: string;
    CUBESANDBOX_TENANT_KEY?: string;
  }
}

export {};
