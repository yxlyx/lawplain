import type { MetadataRoute } from "next";
import { DEFAULT_DESCRIPTION, SITE_NAME } from "@/lib/seo";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} - Singapore Legal Research`,
    short_name: SITE_NAME,
    description: DEFAULT_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: "#faf8f2",
    theme_color: "#23382f",
    icons: [
      { src: "/lawplain-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/lawplain-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
