# Local production performance audit

Audited 9 September 2026 with Lighthouse 13.4.1, Chrome 152, against the production Next build at http://localhost:3012/. Mobile used Lighthouse's default simulated mobile throttling; desktop used its desktop preset. These are local lab results, not deployed PageSpeed Insights or field Core Web Vitals. Cloudflare builds also passed; actual network, region, cache and server latency can change live results.

| Profile | Performance | Accessibility | Best practices | SEO | LCP | CLS |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| mobile | 95 | 100 | 100 | 100 | 2.9 s | 0 |
| desktop | 100 | 100 | 100 | 100 | 0.8 s | 0.002 |

- [Mobile report](home-mobile.report.html)
- [Desktop report](home-desktop.report.html)
- JSON reports and summary accompany the HTML.

## Changes measured

- Responsive hero images: the phone illustration is 17,342 bytes instead of the 304,910-byte original. Tablet/desktop select 640/960/1680-pixel sources.
- Monospace font is fetched only when used, not preloaded on every page.
- Consent notice uses concise text and larger touch buttons.
- Footer wraps deliberately and reserves touch-friendly link space.
- Shared ivory/forest palette passes normal-text contrast checks on all three surfaces in light and dark modes.

## Reproduce

Run the production build, then start Next on port 3012 with an ephemeral local BETTER_AUTH_SECRET and BETTER_AUTH_URL=http://localhost:3012. The secret is needed so the guest session endpoint works in production mode; no real account or Google credentials were used.

```sh
npx lighthouse http://localhost:3012/ --chrome-flags='--headless=new' --output=json --output=html --output-path=docs/performance/home-mobile --only-categories=performance,accessibility,best-practices,seo
npx lighthouse http://localhost:3012/ --preset=desktop --chrome-flags='--headless=new' --output=json --output=html --output-path=docs/performance/home-desktop --only-categories=performance,accessibility,best-practices,seo
```

## Other verification

329 tests and production Cloudflare build passed. Visually reviewed home, footer, library, ruling, Ask landing and shared answer preview at phone widths down to 320px in light/dark themes; checked 390px, tablet and desktop compositions. Ruling text routes return 404 for missing rulings, 400 for invalid offsets, and 416 for offsets beyond the document. Two text segments for 2007_SGCA_37 reassembled exactly to its 113,314-character source. Every one of the 10,614 ruling links in the 54 Markdown directory pages matches the judgment sitemap snapshot.
