# Lawplain reading garden — local design review

Preview: http://localhost:3011/ · answer sample: http://localhost:3011/design-preview · real Ask page: http://localhost:3011/ask

This branch includes the deployed Condensation fix and keeps all design work local. The sample answer route returns 404 outside development. It uses the same AnswerMarkdown and AnswerSources components as the real assistant; sample content is explicitly labelled.

## Design references

- Mobbin: [Browserbase hero](https://mobbin.com/sites/sections/8616612a-cd9d-478e-969c-a11502c3d35b), inspected through Mobbin MCP. Landscape framing and headline hierarchy.
- [Rare UI](https://github.com/swamimalode07/rare-ui), folder-component. Its folder silhouette and layered-paper design are adapted into ResearchFolder with CSS hover/focus motion. No Motion dependency; no pointer-only toggle. The MIT license is retained in RARE-UI-LICENSE.txt.
- [Beautiful UI streaming text](https://www.beautifului.dev/#streaming-text) and [tool chips](https://www.beautifului.dev/#tool-chips), inspected visually. Inspired the answer source cards and collapsed research summary. Source cards are derived from actual answer links; labels do not claim independent verification.
- User-supplied screenshot: atmospheric painterly landscape, open blue sky, foliage and an outdoor reading/work surface.

## Artwork

Generated with the built-in imagegen tool. Original: `singapore-garden-original.png`. Web asset: `../../public/images/singapore-garden.webp` (1680 × 946, 304,910 bytes). Social preview: `../../src/app/opengraph-image.png` (1200 × 630), composing this illustration with native text. Hero uses precompressed static art without an image-optimization service dependency.

### Final image-generation prompt

Use case: stylized-concept. Asset type: original wide website hero background for Lawplain, Singapore legal research. Reference image in conversation is mood inspiration only: lush painterly landscape, vivid blue sky, beautifully lit green foliage, inviting thoughtful outdoor workspace. Create a wide 16:9 hand-painted animation-background illustration of Singapore's civic district seen from a tranquil shaded reading garden: recognizable historic Supreme Court dome and river with shophouses in the middle distance, tropical rain trees framing the upper right and edges, warm sun on foliage, rich teal shadows, clear azure sky and luminous cumulus clouds. On the lower right a modest wooden reading table with an open book and a few closed books, no people. Keep left half and upper middle mostly open sky and distant softly rendered scenery to support large white website headline. Beautiful detailed brushwork, sophisticated cinematic depth, optimistic and peaceful, not childish. No text, UI, borders, watermarks, logos, gavels, scales, robots or futuristic objects. Produce the landscape artwork alone, not a website screenshot.

## SEO changes and limits

- Seven server-rendered collection pages with unique descriptions, search tips, source links, CollectionPage/ItemList/BreadcrumbList structured data, and cross-links.
- Main sitemap covers public landing pages and collection examples. Separate corpus index points to 21 bounded sitemap shards with 83,827 distinct canonical document URLs, exported from production D1 using read-only ID queries. Statute rows with the same act ID share the existing canonical document route.
- No fabricated `lastmod` dates, ratings, reviews, or FAQ rich-result promises.
- Document highlighting/navigation variants use a canonical URL instead of noindex. Search-result variants and private chats remain excluded from indexing. Incomplete document fallback pages retain noindex.
- Updated title, description, and social preview. Main homepage explanatory copy and library links are present in server HTML.
- Sitemaps improve discovery; they do not guarantee indexing or rankings. Search Console coverage and field Core Web Vitals have not been measured in this local preview.
- Corpus sitemaps are a dated snapshot. Refresh after corpus ingests with `npm run seo:refresh-sitemaps -- /path/to/sglaw/d1-worker/wrangler.jsonc`, using existing Wrangler credentials. The export script reads only public identifiers. Commit generated shards and the snapshot manifest together before a future deployment.

Google references: [crawlable links](https://developers.google.com/search/docs/crawling-indexing/links-crawlable), [canonical URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls), [sitemap indexes](https://developers.google.com/search/docs/crawling-indexing/sitemaps/large-sitemaps).

## Verification

- 322 tests pass, including source-link filtering and all 83,827 sitemap URLs for uniqueness and canonical structure.
- TypeScript and production Next/OpenNext Cloudflare builds pass.
- Browser verified desktop and 390px mobile layouts, light/dark themes, search returning results, Ask landing, and the shared answer components. Mobile document width equals viewport width.
- HTTP checks returned 200 with index/follow and clean canonical URLs for a sample from each of the seven corpora, plus the homepage and collection landing page.
- This turn changes presentation and discovery; it does not rerun the production research pipeline or publish the redesign.
