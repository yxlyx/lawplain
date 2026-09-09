import Link from "next/link";
import { notFound } from "next/navigation";
import { collectionResults } from "@/lib/collection-results";
import { COLLECTIONS } from "@/lib/collections";
import { absoluteUrl, buildMetadata, jsonLdScriptProps } from "@/lib/seo";
export const revalidate = 86400;
export function generateStaticParams() {
  return COLLECTIONS.map((c) => ({ collection: c.slug }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ collection: string }>;
}) {
  const { collection } = await params;
  const c = COLLECTIONS.find((c) => c.slug === collection);
  if (!c) notFound();
  return buildMetadata({
    title: `Singapore ${c.title} — Research & Search`,
    description: c.description,
    path: `/research/${c.slug}`,
  });
}
export default async function CollectionPage({
  params,
}: {
  params: Promise<{ collection: string }>;
}) {
  const { collection } = await params;
  const c = COLLECTIONS.find((c) => c.slug === collection);
  if (!c) notFound();
  const results = await collectionResults(c.slug);
  const structured = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `Singapore ${c.title}`,
    url: absoluteUrl(`/research/${c.slug}`),
    description: c.description,
    mainEntity: {
      "@type": "ItemList",
      itemListElement: results.map((item, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: absoluteUrl(item.path),
        name: item.title,
      })),
    },
    breadcrumb: {
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
          name: "Research library",
          item: absoluteUrl("/research"),
        },
        {
          "@type": "ListItem",
          position: 3,
          name: c.title,
          item: absoluteUrl(`/research/${c.slug}`),
        },
      ],
    },
  };
  return (
    <main className="collection-page">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: jsonLdScriptProps escapes untrusted text before embedding JSON-LD.
        dangerouslySetInnerHTML={jsonLdScriptProps(structured)}
      />
      <nav>
        <Link href="/">Lawplain</Link> /{" "}
        <Link href="/research">Research library</Link> / {c.title}
      </nav>
      <p className="garden-kicker mt-9">SINGAPORE LEGAL CORPUS</p>
      <h1>Singapore {c.title.toLowerCase()}.</h1>
      <p className="intro">{c.description}</p>
      <p className="intro mt-5">{c.body}</p>
      <Link
        href={`/?tab=${c.tab}&q=${encodeURIComponent(c.query)}`}
        className="garden-cta"
      >
        Search {c.title.toLowerCase()} <span aria-hidden="true">↗</span>
      </Link>
      <h2>A useful way to begin</h2>
      <ol className="collection-tips">
        {c.tips.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ol>
      <h2>Explore “{c.query}”</h2>
      <p className="intro mb-6">
        A starting selection from full-text search, not a complete list or an
        assessment of legal relevance.
      </p>
      {results.length ? (
        <div className="collection-results">
          {results.map((item) => (
            <Link
              key={item.path}
              href={item.path}
              className="collection-result"
            >
              <small>{item.label}</small>
              <h3>{item.title} ↗</h3>
            </Link>
          ))}
        </div>
      ) : (
        <p className="intro">
          The source list is temporarily unavailable. You can still use the
          search above.
        </p>
      )}
      <p className="intro mt-9">
        Legal information, not legal advice. Check the current official source
        before relying on any document.
      </p>
      <nav
        className="mt-9 flex flex-wrap gap-4"
        aria-label="Other research collections"
      >
        {COLLECTIONS.filter((x) => x.slug !== c.slug).map((x) => (
          <Link href={`/research/${x.slug}`} key={x.slug}>
            {x.title} ↗
          </Link>
        ))}
      </nav>
    </main>
  );
}
