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
  // The auth pages live at /sign-in and /sign-up. The addresses people guess and
  // old links point at used to fall through to the corpus 404, which claims we
  // could not find a *document* — a search failure, not a wrong address (#205).
  // `permanent: false` because these are conveniences, not the canonical names.
  async redirects() {
    return [
      { source: "/login", destination: "/sign-in", permanent: false },
      { source: "/signin", destination: "/sign-in", permanent: false },
      { source: "/log-in", destination: "/sign-in", permanent: false },
      { source: "/signup", destination: "/sign-up", permanent: false },
      { source: "/register", destination: "/sign-up", permanent: false },
    ];
  },
};

export default nextConfig;
