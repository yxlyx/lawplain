import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // The IDE browser-preview proxies the dev server via 127.0.0.1, which Next 16
  // treats as a cross-origin dev request and blocks (breaking HMR + hydration).
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
