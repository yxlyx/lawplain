import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  reactCompiler: true,
  // @codegraff/sdk ships raw .ts (its package "main" is harness.ts). Next must
  // compile it rather than treat it as prebuilt JS, or imports fail at runtime.
  transpilePackages: ["@codegraff/sdk"],
  // Avoid Turbopack walking up to a parent workspace when another lockfile is
  // present outside this app directory.
  turbopack: {
    root: process.cwd(),
  },
  // The IDE browser-preview proxies the dev server via 127.0.0.1, which Next 16
  // treats as a cross-origin dev request and blocks (breaking HMR + hydration).
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
