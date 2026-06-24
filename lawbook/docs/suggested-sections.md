# Design: Anonymous usage analytics → "Suggested sections"

Status: **Spec / not yet implemented.** Captures the agreed design so it can be
built later without re-deriving decisions.

## 1. Goal

Collect anonymous, aggregate usage signals about how readers engage with a
document for a given search keyword, and — once enough data exists — surface the
**most-sought sections** for that keyword as side-tabs / jump links on the
article. A keyword may appear many times in one judgment; this highlights the
passage(s) readers actually dwell on, not just every literal match.

Non-goals: per-user profiles, identity, cross-site tracking, personalised feeds.

## 2. Privacy posture (non-negotiable)

- **No identifiers.** The feature works purely by incrementing counters, so we
  never need a user/session id. (If de-duplication is later required, use an
  ephemeral per-tab random id held only in memory — never persisted, never sent
  with anything that could re-identify.)
- **No PII, no free text beyond the search term**, which is already user-typed
  and not personal.
- **Respect `navigator.doNotTrack`** — skip all logging when set.
- **Aggregate-only reads.** The suggestion endpoint can only ever return counts,
  never raw events.
- **Consent/notice.** Show a one-line notice ("We record anonymous, aggregate
  usage to highlight popular passages") with a dismiss + opt-out stored in
  `localStorage`. Honour opt-out before any logging.
- **Threshold gating.** Never reveal suggestions until the sample for a
  `{docId, term}` pair is large enough (see §6), both for usefulness and to
  avoid leaking small-N behaviour.

## 3. What is a "section"

| Corpus    | Section unit            | Stable id source                          |
|-----------|-------------------------|-------------------------------------------|
| Statutes  | Real section            | `section_no` (already in `StatuteSection`)|
| Judgments | Detected heading block  | slug of heading text + ordinal            |

Judgments have no formal sections, but `JudgmentBody`'s `parseBlocks()` already
classifies `heading` blocks (Introduction, Facts, …). Assign each heading a
stable anchor id, e.g. `sec-<index>-<slug>`, where `slug` is the lowercased,
hyphenated heading. The ordinal guards against duplicate heading text.

These same anchors power the side-tab navigation UI.

## 4. Event schema

Single event type, sent via `navigator.sendBeacon` (fire-and-forget, survives
navigation):

```jsonc
POST /api/events
{
  "kind": "section_engage",   // only kind for now
  "docType": "judgment" | "statute",
  "docId": "2023_SGHC_3",      // citation or act_id
  "term": "transnational",     // single normalised keyword (lowercased)
  "sectionId": "sec-3-facts"
}
```

Notes:
- The client expands the multi-word query into individual normalised terms
  (same `parseTerms()` logic already in `JudgmentBody`) and emits one event per
  (term, sectionId) engagement. Keeps the data model 1-dimensional in `term`.
- Server validates: known `docType`, non-empty strings, length caps, and a
  basic rate limit per IP (see §8). Reject anything else with 204 (silent).

## 5. What triggers an event (the "engagement" signal)

Presence of a keyword is cheap; **engagement** is the real signal. Log when:

1. **Dwell** — a section scrolls into view and stays visible > ~3s
   (`IntersectionObserver` + timer; fire once per section per page view).
2. **Active-match landing** — the user steps the match navigator (Next/Prev)
   onto a match inside a section. `JudgmentBody` already tracks `activeIndex`;
   map the active `<mark>` to its enclosing section.

Debounce/coalesce so one page view contributes at most one event per
(term, sectionId).

## 6. Data model & aggregation

Storage-agnostic, but designed for a Redis-style counter store.

### Redis (recommended shape)
- Popularity, per document+term, as a sorted set:
  - Write: `ZINCRBY suggest:{docType}:{docId}:{term} 1 {sectionId}`
  - Total sample (for gating): `INCR seen:{docType}:{docId}:{term}`
    (or derive from `ZSCORE` sum; a separate counter is cheaper to read)
  - Read top N: `ZREVRANGE suggest:{docType}:{docId}:{term} 0 4 WITHSCORES`
- Optional TTL (e.g. 180d) so trends reflect recent behaviour.

### SQL alternative (Postgres/SQLite)
```sql
CREATE TABLE section_engagement (
  doc_type   text NOT NULL,
  doc_id     text NOT NULL,
  term       text NOT NULL,
  section_id text NOT NULL,
  count      bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (doc_type, doc_id, term, section_id)
);
-- upsert: INSERT ... ON CONFLICT (...) DO UPDATE SET count = count + 1;
-- read:   SELECT section_id, count FROM section_engagement
--         WHERE doc_type=$1 AND doc_id=$2 AND term=$3
--         ORDER BY count DESC LIMIT 5;
```

## 7. Read endpoint

```jsonc
GET /api/suggestions?docType=judgment&docId=2023_SGHC_3&term=transnational
// 200 — only when total >= MIN_SAMPLE (e.g. 30)
{
  "total": 142,
  "sections": [
    { "sectionId": "sec-7-issue-estoppel", "count": 88 },
    { "sectionId": "sec-3-facts",          "count": 31 }
  ]
}
// 200 with sections:[] when below threshold (client renders nothing)
```

`MIN_SAMPLE` and the top-N are config constants. Keep responses cacheable
(`s-maxage` ~5min) since they change slowly.

## 8. Abuse / integrity

- Rate-limit writes per IP (e.g. token bucket via Redis) so a single client
  can't skew counts; cap events per page view client-side too.
- Cap distinct `term` cardinality per doc to avoid unbounded keyspace.
- Treat the write endpoint as best-effort; never block rendering on it.

## 9. UI: side-tabs

- Add a sticky vertical rail (desktop) / horizontal chip row (mobile) beside the
  judgment body listing the document's detected sections as jump links.
- When a `term` is present (`?q=`) and `/api/suggestions` returns ranked
  sections above threshold, badge/sort the most-sought ones to the top and label
  them ("Most viewed for 'transnational'").
- Below threshold → plain section navigation only (no popularity hints).

## 10. Build order (when greenlit)

1. Give judgment headings stable anchor ids in `parseBlocks()` + render the
   plain side-tab navigation (useful on its own, no backend needed).
2. Stand up `/api/events` + chosen store; add client logging behind consent +
   DNT checks.
3. Add `/api/suggestions` + threshold gating. ✅ Done — `GET /api/suggestions`
   (`src/app/api/suggestions/route.ts`, `src/lib/suggestions.ts`, migration
   `migrations/0003_section_engagement.sql`).
4. Layer popularity ordering/badges onto the side-tabs.

## 11. Open questions

- Hosting/runtime for the store (Upstash Redis vs Postgres vs other).
- `MIN_SAMPLE` value and whether to gate per-term or per-document.
- Whether dwell-time alone is sufficient or we also weight match clicks higher.
- Data retention window / TTL.
