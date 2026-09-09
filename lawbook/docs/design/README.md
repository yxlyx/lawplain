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

## September 9 refinement: colors, mobile and machine-readable rulings

The shared palette now uses ivory paper (#faf8f2), forest ink (#23382f), sage accents, and muted river-blue source markers. Dark mode uses #121e1a / #1b2c24 / #25392f surfaces, warm off-white text and soft sage accents. Existing annotation category colors remain distinct. The new contrast tests check foreground, secondary text and accent text on all shared surfaces in both themes.

The footer is a small brand/link group with a separate legal line on mobile. The library uses compact single-column source cards on phones. The main search controls have larger touch targets, and text fields stay at 16px to avoid iOS focus zoom. Lighthouse results and reproducible commands are in [the performance audit](../performance/README.md).

### Updated social card

`src/app/opengraph-image.png` is the 1200×630 social asset. It was edited using the built-in image-generation tool, then resized/encoded for the project. Original generated output: `/Users/rachpradhan/.codex/generated_images/01a083db-2c29-7873-af61-8f9bcabc4a11/exec-8cf1c80d-ef5d-43e7-8619-72959a450069.png`.

Exact edit prompt:

> Update this Lawplain website social sharing Open Graph card. Wide aspect ratio 1200:630. Preserve beautiful painterly Singapore garden, Supreme Court dome, river and lush foliage on right. Redesign left as a clean warm ivory solid field occupying 52% width, with a crisp vertical transition to landscape (no faded gradient). Dark charcoal text on ivory. Small serif brand 'Lawplain.' at top left, main large elegant serif headline in two lines 'Research' and 'Singapore law.' at left center. Small readable sans serif below: 'Judgments, legislation and cited answers.' Bottom left small 'lawplain.com'. Refined editorial layout, abundant whitespace, no buttons, no extra text. All text must fit with at least 60px margin. This is finished OG card, not a webpage mockup.

### AI-readable public corpus

- `/llms.txt` is the main overview. `/llm.txt` redirects to it.
- `/judgment/llms.txt` links to 54 small directories covering the 10,614 mirrored ruling identifiers.
- Each ruling exposes `/judgment/{citation}/index.md` and `/judgment/{citation}/llms.txt`. Long rulings use 60,000-character chunks with labelled ranges and continuation links. Offsets count Unicode code points to match SQLite, including supplementary characters.
- HTML metadata advertises the Markdown alternative; text responses include canonical, directory and next-segment Link headers.
- `seo:refresh-sitemaps` also refreshes the ruling directories; `node scripts/generate-llms-index.mjs` rebuilds them from the current sitemap snapshot.
- The robots wildcard permits public documents for search and AI crawlers. Private account, API and conversation paths remain excluded. robots.txt is crawl guidance, not authentication or a promise of indexing.

References: [llms.txt proposal](https://llmstxt.org/), [OpenAI crawler documentation](https://developers.openai.com/api/docs/bots), [Lighthouse documentation](https://developer.chrome.com/docs/lighthouse/overview).
