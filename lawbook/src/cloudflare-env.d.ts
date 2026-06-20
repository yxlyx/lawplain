/// <reference types="@cloudflare/workers-types" />

declare global {
  interface CloudflareEnv {
    AUTH_DB?: D1Database;
  }
}

export {};
