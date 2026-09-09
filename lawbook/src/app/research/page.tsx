import Link from "next/link";
import { ResearchFolder } from "@/components/ResearchFolder";
import { COLLECTIONS } from "@/lib/collections";
import { buildMetadata } from "@/lib/seo";
export const metadata = buildMetadata({
  title: "Singapore Law Library — Judgments, Statutes & Parliament",
  description:
    "Explore Singapore legal research collections: judgments, statutes, Hansard, bills, subsidiary legislation, practice directions, and agency guidance.",
  path: "/research",
});
export default function ResearchLibrary() {
  return (
    <main className="collection-page">
      <nav>
        <Link href="/">Lawplain</Link> / Research library
      </nav>
      <p className="garden-kicker mt-9">THE RESEARCH SHELF</p>
      <h1>
        One library.
        <br />
        Many ways to understand.
      </h1>
      <p className="intro">
        Explore Singapore law by source. Each collection offers a starting
        point, practical search tips, and links into the corpus. Search and read
        the public documents without signing in.
      </p>
      <div className="garden-folder-grid mt-10">
        {COLLECTIONS.map((c, i) => (
          <Link
            key={c.slug}
            href={`/research/${c.slug}`}
            className="garden-collection-card"
          >
            <ResearchFolder tone={i % 4} />
            <span className="garden-card-index">0{i + 1} / COLLECTION</span>
            <h3>
              {c.title} <span aria-hidden="true">↗</span>
            </h3>
            <p>{c.short}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
