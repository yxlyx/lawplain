/**
 * Relevance indicator. bm25 `score` is negative and already sorted (best first);
 * we display a relative bar within the current result set rather than the raw
 * number, which is meaningless to a reader.
 */
export function ScoreBar({ fraction }: { fraction: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  return (
    <span
      className="inline-flex items-center gap-1.5"
      role="img"
      title={`Relevance ${pct}%`}
      aria-label={`Relevance ${pct} percent`}
    >
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-2">
        <span
          className="block h-full rounded-full bg-accent transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="text-[11px] font-medium tabular-nums text-muted-2">
        {pct}%
      </span>
    </span>
  );
}
