import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/saved",
          "/sign-in",
          "/sign-up",
          "/suggestions-preview",
        ],
      },
    ],
    sitemap: [
      `${SITE_ORIGIN}/sitemap.xml`,
      `${SITE_ORIGIN}/corpus-sitemap.xml`,
    ],
    host: SITE_ORIGIN,
  };
}
