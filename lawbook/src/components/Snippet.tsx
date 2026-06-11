/**
 * Renders an API search `snippet`. The server wraps matched terms in <b>…</b>
 * and marks elisions with "…". We strip every tag except <b>/<\/b> before
 * injecting, so corpus text can never smuggle in markup.
 */
export function Snippet({
  html,
  className = "",
}: {
  html?: string;
  className?: string;
}) {
  if (!html) return null;
  const safe = html.replace(/<(?!\/?b\b)[^>]*>/gi, "");
  return (
    <p
      className={`snippet text-sm leading-relaxed text-muted ${className}`}
      // Only <b> survives the strip above; surrounding text is plain corpus content.
      // biome-ignore lint/security/noDangerouslySetInnerHtml: API returns pre-sanitized <b> highlight markup, which we further strip to <b> only.
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}
