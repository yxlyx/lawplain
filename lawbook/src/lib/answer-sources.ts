export function answerSources(text: string) {
  const sources: { href: string; label: string; kind: string }[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/\[([^\]\n]+)\]\(([^\s)]+)\)/g)) {
    let url: URL;
    try {
      url = new URL(match[2], "https://lawplain.com");
    } catch {
      continue;
    }
    if (
      url.origin !== "https://lawplain.com" ||
      !/^\/(judgment|statute|document)\//.test(url.pathname)
    )
      continue;
    const href = url.pathname;
    if (seen.has(href)) continue;
    seen.add(href);
    sources.push({
      href,
      label: match[1],
      kind: href.startsWith("/judgment/")
        ? "Singapore judgment"
        : href.startsWith("/statute/")
          ? "Singapore legislation"
          : "Corpus document",
    });
  }
  return sources;
}
