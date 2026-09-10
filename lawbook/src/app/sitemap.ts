import type { MetadataRoute } from "next";
import { BLOG_POSTS, blogPath } from "@/lib/blog";
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
    "/developers/mcp",
    "/blog",
    ...BLOG_POSTS.map(blogPath),
    ...COLLECTIONS.map((c) => `/research/${c.slug}`),
  ]);
  const collections = await Promise.all(
    COLLECTIONS.map((c) => collectionResults(c.slug)),
  );
  for (const items of collections)
    for (const item of items) paths.add(item.path);
  return [...paths].map((path) => {
    const post = BLOG_POSTS.find((post) => blogPath(post) === path);
    return {
      url: absoluteUrl(path),
      ...(post ? { lastModified: post.date } : {}),
    };
  });
}
