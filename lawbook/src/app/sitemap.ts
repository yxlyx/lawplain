import type { MetadataRoute } from "next";
import { collectionResults } from "@/lib/collection-results";
import { COLLECTIONS } from "@/lib/collections";
import { absoluteUrl } from "@/lib/seo";
export const revalidate = 86400;
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const paths = new Set([
    "/",
    "/ask",
    "/research",
    "/faq",
    "/developers",
    ...COLLECTIONS.map((c) => `/research/${c.slug}`),
  ]);
  const collections = await Promise.all(
    COLLECTIONS.map((c) => collectionResults(c.slug)),
  );
  for (const items of collections)
    for (const item of items) paths.add(item.path);
  return [...paths].map((path) => ({ url: absoluteUrl(path) }));
}
