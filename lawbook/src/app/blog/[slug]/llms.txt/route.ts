import { BLOG_POSTS, blogMarkdown } from "@/lib/blog";

export const dynamic = "force-static";
export const dynamicParams = false;
export function generateStaticParams() {
  return BLOG_POSTS.map(({ slug }) => ({ slug }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const post = BLOG_POSTS.find((item) => item.slug === slug);
  if (!post) return new Response("Article not found", { status: 404 });
  return new Response(blogMarkdown(post), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
