/** Adapted from Rare UI's MIT-licensed folder-component (swamimalode07).
 * Retains its folder silhouette and layered paper treatment; CSS hover/focus
 * replaces pointer-only JS and honors the site's reduced-motion preference.
 * License: docs/design/RARE-UI-LICENSE.txt.
 */
export function ResearchFolder({ tone = 0 }: { tone?: number }) {
  return (
    <div className={`research-folder folder-tone-${tone}`} aria-hidden="true">
      <div className="folder-back" />
      {[0, 1, 2].map((n) => (
        <div key={n} className={`folder-paper paper-${n}`}>
          <span />
          <span />
          <span />
          <span />
        </div>
      ))}
      <svg
        aria-hidden="true"
        className="folder-flap"
        viewBox="0 0 321 241"
        fill="none"
      >
        <path
          d="M0 25C0 11.1929 11.1929 0 25 0H136.084C143.044 0 149.689 2.90139 154.42 8.00608L178.08 33.5343C182.811 38.639 189.456 41.5404 196.416 41.5404H296C309.807 41.5404 321 52.7333 321 66.5404V216C321 229.807 309.807 241 296 241H25C11.1929 241 0 229.807 0 216V25Z"
          fill="currentColor"
        />
      </svg>
      <span className="folder-seal">L.</span>
    </div>
  );
}
