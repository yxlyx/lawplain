import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import {
  AccessDiagram,
  ExperimentDiagram,
  ResearchDiagram,
  SourceDiagram,
} from "@/components/blog/ResearchDiagrams";
import {
  BLOG_POSTS,
  blogArticleJsonLd,
  blogPath,
  blogReadingMinutes,
} from "@/lib/blog";
import { absoluteUrl, buildMetadata, jsonLdScriptProps } from "@/lib/seo";

// Allow the Worker to render known posts when its prerender cache is cold.
// Unknown slugs still return notFound() below.
export const revalidate = 86400;
export function generateStaticParams() {
  return BLOG_POSTS.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = BLOG_POSTS.find((item) => item.slug === slug);
  if (!post) notFound();
  const base = buildMetadata({
    title: post.seoTitle,
    description: post.description,
    path: blogPath(post),
    type: "article",
  });
  return {
    ...base,
    authors: [{ name: post.author }],
    openGraph: {
      ...base.openGraph,
      type: "article",
      publishedTime: `${post.date}T00:00:00+08:00`,
      modifiedTime: `${post.date}T00:00:00+08:00`,
      authors: [post.author],
      images: [
        { url: post.image, width: 1200, height: 630, alt: post.subtitle },
      ],
    },
    twitter: { ...base.twitter, images: [post.image] },
  };
}

export default async function BlogArticle({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = BLOG_POSTS.find((item) => item.slug === slug);
  if (!post) notFound();
  return (
    <main className="blog-article-page">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: Escaped JSON-LD from first-party content.
        dangerouslySetInnerHTML={jsonLdScriptProps([
          blogArticleJsonLd(post),
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              {
                "@type": "ListItem",
                position: 1,
                name: "Lawplain",
                item: absoluteUrl("/"),
              },
              {
                "@type": "ListItem",
                position: 2,
                name: "Blog",
                item: absoluteUrl("/blog"),
              },
              {
                "@type": "ListItem",
                position: 3,
                name: post.title,
                item: absoluteUrl(blogPath(post)),
              },
            ],
          },
        ])}
      />
      <nav className="blog-breadcrumb" aria-label="Breadcrumb">
        <Link href="/blog">← All notes</Link>
        <span>{post.category}</span>
      </nav>
      <article>
        <header className="blog-article-header">
          <p className="blog-eyebrow">Engineering / 01</p>
          <h1>{post.title}</h1>
          <p className="blog-deck">{post.subtitle}</p>
          <div className="blog-byline">
            <span>{post.author}</span>
            <time dateTime={post.date}>{post.dateLabel}</time>
            <span>{blogReadingMinutes(post)} min read</span>
          </div>
        </header>
        <div className="blog-article-grid">
          <aside className="blog-toc">
            <nav aria-label="On this page">
              <p>In this note</p>
              {post.sections.map((section, i) => (
                <a key={section.id} href={`#${section.id}`}>
                  <span>0{i + 1}</span>
                  {section.title}
                </a>
              ))}
              <a
                className="blog-plain-link"
                href={`${blogPath(post)}/llms.txt`}
              >
                Read as plain text ↗
              </a>
            </nav>
          </aside>
          <details className="blog-mobile-toc">
            <summary>In this note</summary>
            <nav aria-label="On this page">
              {post.sections.map((section, i) => (
                <a key={section.id} href={`#${section.id}`}>
                  <span>0{i + 1}</span> {section.title}
                </a>
              ))}
              <a href={`${blogPath(post)}/llms.txt`}>Read as plain text ↗</a>
            </nav>
          </details>
          <div className="blog-prose">
            <p className="blog-introduction">{post.introduction}</p>
            {post.sections.map((section) => (
              <section id={section.id} key={section.id}>
                <h2>{section.title}</h2>
                <ReactMarkdown>{section.body}</ReactMarkdown>
                {"diagram" in section &&
                  {
                    research: <ResearchDiagram />,
                    sources: <SourceDiagram />,
                    experiments: <ExperimentDiagram />,
                    access: <AccessDiagram />,
                  }[section.diagram]}
              </section>
            ))}
            <div className="blog-editorial-note">
              <strong>About this note</strong>
              <p>
                Based on Lawplain’s research implementation and our internal
                sglaw evaluation records. Graff’s public capabilities are
                described at <a href="https://codegraff.com/">codegraff.com</a>.
                Experimental findings are scoped to the tasks tested.
              </p>
            </div>
          </div>
        </div>
      </article>
      <div className="blog-endnote">
        <Link href="/blog">← Back to the blog</Link>
        <Link href="/ask">Start your research ↗</Link>
      </div>
    </main>
  );
}
