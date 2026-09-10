import Link from "next/link";
import { ResearchDiagram } from "@/components/blog/ResearchDiagrams";
import { BLOG_POSTS, blogPath, blogReadingMinutes } from "@/lib/blog";
import { absoluteUrl, buildMetadata, jsonLdScriptProps } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Blog — building Singapore legal research",
  description:
    "Notes from building Lawplain: AI research agents, Singapore legal sources and the experiments behind the product.",
  path: "/blog",
});

export default function BlogPage() {
  return (
    <main className="blog-index">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: Escaped JSON-LD from first-party content.
        dangerouslySetInnerHTML={jsonLdScriptProps({
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "Lawplain blog",
          url: absoluteUrl("/blog"),
          mainEntity: {
            "@type": "ItemList",
            itemListElement: BLOG_POSTS.map((post, i) => ({
              "@type": "ListItem",
              position: i + 1,
              url: absoluteUrl(blogPath(post)),
              name: post.title,
            })),
          },
        })}
      />
      <header className="blog-index-header">
        <p className="blog-eyebrow">The Lawplain blog</p>
        <h1>Notes from the work.</h1>
        <p>
          On legal research, the tools we build, and what we learn along the
          way.
        </p>
      </header>
      {BLOG_POSTS.map((post) => (
        <article className="blog-feature" key={post.slug}>
          <div className="blog-feature-copy">
            <div className="blog-meta">
              <span>{post.category}</span>
              <span>Article 01</span>
            </div>
            <h2>
              <Link href={blogPath(post)}>{post.title}</Link>
            </h2>
            <p className="blog-feature-subtitle">{post.subtitle}</p>
            <p>
              Inside the research workflow, the source collection, and the
              experiments that shaped it.
            </p>
            <div className="blog-meta">
              <time dateTime={post.date}>{post.dateLabel}</time>
              <span>{blogReadingMinutes(post)} min read</span>
            </div>
            <Link className="blog-read-link" href={blogPath(post)}>
              Read the story <span aria-hidden="true">↗</span>
            </Link>
          </div>
          <Link
            className="blog-feature-visual"
            href={blogPath(post)}
            aria-label={`Read ${post.title}`}
          >
            <ResearchDiagram compact />
          </Link>
        </article>
      ))}
      <aside className="blog-index-note">
        <p>Built for the next step in your research.</p>
        <div>
          <Link href="/ask">Ask Lawplain ↗</Link>
          <Link href="/developers/mcp">Use your own agent ↗</Link>
        </div>
      </aside>
    </main>
  );
}
