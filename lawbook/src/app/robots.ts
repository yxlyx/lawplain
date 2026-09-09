import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        // Wildcard permits search and AI crawlers on every public document.
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/saved",
          "/recents",
          "/ask/",
          "/design-preview",
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
