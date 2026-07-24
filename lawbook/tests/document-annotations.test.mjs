import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const hook = read("src/hooks/useDocumentAnnotations.ts");
const layer = read("src/components/DocumentAnnotations.tsx");
const judgmentBody = read("src/components/JudgmentBody.tsx");
const statuteShell = read("src/components/StatuteSectionShell.tsx");
const judgmentPage = read("src/app/judgment/[citation]/page.tsx");
const statutePage = read("src/app/statute/[reference]/page.tsx");

const card = layer.slice(layer.indexOf("function AnnotationCard("));

test("a signed-out reader gets no annotation layer at all", () => {
  assert.match(hook, /const ownerId = session\?\.user\.id \?\? null/);
  // The request is unreachable without an owner, and owner-scoped state is
  // cleared on every account change rather than left for the next account.
  assert.match(
    hook,
    /setAnnotations\(\[\]\);\s+setAnchored\(\[\]\);\s+setActiveId\(null\);\s+setError\(null\);\s+\}, \[docId, docType, ownerId\]\);/,
  );
  assert.match(
    hook,
    /if \(!ownerId\) return;[\s\S]*?fetch\(`\/api\/annotations/,
  );
  assert.match(
    hook,
    /const ownerStateIsCurrent = Boolean\(ownerId\) && dataOwnerId === ownerId;\s+const visible = ownerStateIsCurrent \? annotations : NO_ANNOTATIONS;/,
  );
  assert.match(
    layer,
    /if \(!ownerId \|\| \(annotations\.length === 0 && !error\)\)\s*\n?\s*return null;/,
  );
});

test("a document's annotations are fetched uncached and exhausted by cursor", () => {
  assert.match(
    hook,
    /new URLSearchParams\(\{\s+docType,\s+docId,\s+limit: String\(PAGE_LIMIT\),\s+\}\)/,
  );
  assert.match(
    hook,
    /fetch\(`\/api\/annotations\?\$\{params\}`, \{\s+cache: "no-store",\s+signal: controller\.signal,\s+\}\)/,
  );
  assert.match(
    hook,
    /cursor = data\.nextCursor \?\? null;\s+if \(!cursor\) break;/,
  );
  assert.match(hook, /if \(cursor\) params\.set\("cursor", cursor\);/);
});

test("an in-flight load can never land in a newer account's view", () => {
  assert.match(hook, /const version = \+\+requestVersion\.current;/);
  assert.match(
    hook,
    /if \(controller\.signal\.aborted \|\| version !== requestVersion\.current\)\s+return;\s+collected\.push/,
  );
  assert.match(
    hook,
    /return \(\) => \{\s+controller\.abort\(\);\s+requestVersion\.current \+= 1;\s+\};\s+\}, \[docId, docType, ownerId, refreshToken\]\);/,
  );
  // Resolved ranges belong to a document, so they are dropped when it changes
  // rather than on every refetch, which would unpaint every live highlight.
  assert.match(
    hook,
    /rangesRef\.current\.clear\(\);\s+setDataOwnerId\(ownerId\);/,
  );
});

test("a passage highlighted from the toolbar appears without a reload", () => {
  const tools = read("src/components/SelectionTools.tsx");
  assert.match(hook, /export const ANNOTATIONS_CHANGED_EVENT =/);
  // The toolbar cannot reach this hook's state, so it announces and the hook
  // re-fetches; otherwise a new highlight stays untinted until a full reload.
  assert.match(
    tools,
    /setSaved\(true\);[\s\S]*?window\.dispatchEvent\(new Event\(ANNOTATIONS_CHANGED_EVENT\)\)/,
  );
  assert.match(
    hook,
    /window\.addEventListener\(ANNOTATIONS_CHANGED_EVENT, refresh\);[\s\S]*?removeEventListener\(ANNOTATIONS_CHANGED_EVENT, refresh\)/,
  );
  // Announcing only after a confirmed write keeps a failed save from painting.
  assert.doesNotMatch(
    tools,
    /setError\("Could not save annotation\."\);\s+window\.dispatchEvent/,
  );
});

test("a cached range is re-read, not trusted because its nodes are connected", () => {
  // React reuses a keyed text node when a paginated block grows and rewrites it
  // in place; the Range survives pointing at whatever now occupies those
  // offsets, so connectedness alone would silently move the annotation.
  assert.match(
    hook,
    /range\.collapsed \|\|\s+range\.toString\(\) !== item\.exactText/,
  );
  assert.match(hook, /const byId = new Map\(items\.map/);
});

test("an unresolved passage is pending while text loads and orphaned only after", () => {
  assert.match(
    hook,
    /anchoredIds\.has\(annotation\.id\)\s+\? "anchored"\s+: isFullyLoaded\s+\? "orphaned"\s+: "pending";/,
  );
  // "orphaned" must stay unreachable while the body is still paginating.
  assert.equal(hook.match(/\? "orphaned"/g).length, 1);
  assert.match(hook, /\}, \[anchored, isFullyLoaded, visible\]\);/);
  assert.match(
    judgmentBody,
    /<DocumentAnnotations[\s\S]*?isFullyLoaded=\{!hasMore\}/,
  );
  assert.match(
    statuteShell,
    /<DocumentAnnotations[\s\S]*?isFullyLoaded\s*\n\s*\/>/,
  );
});

test("restoration never attaches an annotation to a merely similar passage", () => {
  // findPassageRange requires the exact captured text; a second, looser matcher
  // in this layer is what would silently mislabel someone else's paragraph.
  assert.equal(hook.match(/findPassageRange\(/g).length, 1);
  assert.doesNotMatch(hook, /textContent|toLowerCase|localeCompare|slice\(/);
  assert.doesNotMatch(layer, /findPassageRange|rangeForOffsets/);
});

test("painting goes through the Custom Highlight API and rewrites no markup", () => {
  assert.match(hook, /setCanPaint\(supportsHighlightApi\(\)\);/);
  assert.match(hook, /if \(!canPaint\) return;/);
  assert.match(
    hook,
    /const registry = \(CSS as unknown as \{ highlights\?: HighlightRegistry \}\)\s+\.highlights;/,
  );
  assert.match(hook, /const HIGHLIGHT_PREFIX = "lawplain-annotation-";/);
  assert.match(
    hook,
    /const token = annotationLabelToken\(annotation\.label\);/,
  );
  assert.match(
    hook,
    /const name = `\$\{HIGHLIGHT_PREFIX\}\$\{token\}`;\s+registry\.set\(name, new HighlightClass\(\.\.\.group\)\);/,
  );
  // Links, citations, section anchors and mark[data-match] survive only because
  // nothing here touches the document's own nodes.
  for (const source of [hook, layer]) {
    assert.doesNotMatch(
      source,
      /createElement|surroundContents|insertNode|innerHTML|outerHTML|replaceChildren|cloneContents/,
    );
  }
});

test("the annotation being read wins wherever highlights overlap", () => {
  assert.match(
    hook,
    /const ACTIVE_HIGHLIGHT = `\$\{HIGHLIGHT_PREFIX\}active`;/,
  );
  assert.match(
    hook,
    /const highlight = new HighlightClass\(activeRange\);[\s\S]*?highlight\.priority = 1;\s+registry\.set\(ACTIVE_HIGHLIGHT, highlight\);/,
  );
});

test("every registered highlight is released on unmount and on account change", () => {
  assert.match(
    hook,
    /return \(\) => \{\s+for \(const name of names\) registry\.delete\(name\);\s+\};\s+\}, \[activeId, anchored, canPaint, visible\]\);/,
  );
  // Clearing the owner's data re-runs that effect, so its cleanup unpaints.
  assert.match(hook, /setAnnotations\(\[\]\);\s+setAnchored\(\[\]\);/);
  assert.match(
    hook,
    /rangesRef\.current\.clear\(\);\s+setDataOwnerId\(ownerId\);/,
  );
});

test("an unpaintable browser still lists and opens every annotation", () => {
  assert.match(hook, /highlightsPainted: canPaint,/);
  assert.match(layer, /\{!highlightsPainted && \(/);
  assert.match(layer, /cannot tint passages in place/);
});

test("clicking a painted passage hit-tests rects and prefers the smallest", () => {
  assert.match(
    hook,
    /const id = passageAtPoint\(anchored, event\.clientX, event\.clientY\);/,
  );
  assert.match(hook, /for \(const rect of range\.getClientRects\(\)\) \{/);
  assert.match(
    hook,
    /if \(hit && \(!best \|\| area < best\.area\)\) best = \{ id, area \};/,
  );
  // A click that belongs to a link or an active selection is left alone.
  assert.match(hook, /closest\("a, button, input, select"\)/);
  assert.match(hook, /if \(selection && !selection\.isCollapsed\) return;/);
});

test("the panel is the keyboard path into every annotation on the page", () => {
  assert.match(
    layer,
    /<aside\s+aria-label="Your private annotations in this document"/,
  );
  assert.match(layer, /aria-expanded=\{listOpen && !active\}/);
  assert.match(layer, /<ul className="flex flex-col gap-0\.5">/);
  assert.match(layer, /onClick=\{\(\) => openFromList\(annotation\)\}/);
  assert.match(layer, /resolveAnnotationLabel\(annotation\.label\)\.name/);
  assert.match(layer, /\{annotation\.note \? "Private note" : "No note"\}/);
  // An orphaned passage has no range, so selecting it explains instead of
  // scrolling somewhere arbitrary.
  assert.match(
    layer,
    /if \(range\) \{\s+scrollRangeIntoView\(range\);\s+return;\s+\}/,
  );
  // Promising a pending passage will appear "as soon as that part of the
  // document loads" is only honest if selecting it actually loads it.
  assert.match(
    layer,
    /if \(statuses\[annotation\.id\] === "pending"\) onRequestMore\?\.\(\);/,
  );
  assert.match(
    read("src/components/JudgmentBody.tsx"),
    /onRequestMore=\{hasMore \? \(\) => void loadMore\(\) : undefined\}/,
  );
  assert.match(
    layer,
    /pending: "Not loaded yet",\s+orphaned: "Passage changed",/,
  );
});

test("the card names its label, cues privacy, and never relies on colour", () => {
  assert.match(card, /Private · only you can see this/);
  assert.match(
    card,
    /<LabelSwatch labelId=\{annotation\.label\} \/>\s+\{label\.name\}/,
  );
  assert.match(
    layer,
    /aria-hidden="true"\s+className="h-2\.5 w-2\.5 shrink-0 rounded-full border"/,
  );
  assert.match(layer, /backgroundColor: `var\(--annotation-\$\{token\}\)`/);
});

test("the card edits the note, relabels, and deletes without a reload", () => {
  assert.match(card, /method: "PATCH"/);
  assert.match(card, /void send\(\{ note: noteDraft\.trim\(\) \|\| null \}/);
  assert.match(card, /\{ANNOTATION_LABELS\.map\(\(option\) => \(/);
  assert.match(card, /aria-pressed=\{option\.id === annotation\.label\}/);
  assert.match(
    card,
    /onClick=\{\(\) => void send\(\{ label: option\.id \}, \(\) => \{\}\)\}/,
  );
  assert.match(
    card,
    /<LabelSwatch labelId=\{option\.id\} \/>\s+\{option\.name\}/,
  );
  assert.match(
    card,
    /\{ method: "DELETE", cache: "no-store", signal: controller\.signal \}/,
  );
  assert.match(card, /\{confirmingDelete \? \(/);
  assert.match(card, /Delete this annotation and its note\?/);
  // Local state carries the change, so the highlight repaints or disappears.
  assert.match(card, /onChanged\(data\.annotation\);/);
  assert.match(card, /onDeleted\(annotation\.id\);/);
  assert.match(
    hook,
    /const remove = useCallback\(\(id: string\) => \{\s+rangesRef\.current\.delete\(id\);\s+setAnchored\(\(current\) => current\.filter/,
  );
});

test("the card takes focus on open and never drops it on close", () => {
  assert.match(card, /if \(event\.key === "Escape"\) onClose\(\);/);
  assert.match(card, /cardRef\.current\?\.focus\(\{ preventScroll: true \}\);/);
  assert.match(
    layer,
    /const fromList = openedFromList\.current;[\s\S]*?close\(\);\s+if \(fromList\) toggleRef\.current\?\.focus\(\);/,
  );
  // Deleting the last annotation unmounts the whole region, so focusing the
  // pill there would land on a button that is about to disappear.
  assert.match(
    layer,
    /const remaining = annotations\.length > 1;\s+remove\(id\);\s+if \(remaining\) toggleRef\.current\?\.focus\(\);/,
  );
  // Disabling the focused label button drops focus to the body; the card puts
  // it back rather than restarting a keyboard reader at the top of the page.
  assert.match(
    card,
    /document\.activeElement === document\.body && focused\?\.isConnected/,
  );
  // An aria-controls pointing at an absent id is an invalid relationship.
  assert.match(
    layer,
    /aria-controls=\{listOpen && !active \? listId : undefined\}/,
  );
});

test("long documents re-resolve in coalesced passes and never redo anchored work", () => {
  assert.match(hook, /const RESOLVE_DEBOUNCE_MS = 120;/);
  assert.match(
    hook,
    /new MutationObserver\(\(\) => \{\s+if \(timer !== null\) return;\s+timer = window\.setTimeout\(/,
  );
  assert.match(
    hook,
    /return \(\) => \{\s+observer\.disconnect\(\);\s+if \(timer !== null\) window\.clearTimeout\(timer\);/,
  );
  // Already-anchored passages are skipped, and a single querySelectorAll pass
  // decides which of the rest are even worth looking for.
  assert.match(
    hook,
    /const unresolved = items\.filter\(\(item\) => !ranges\.has\(item\.id\)\);/,
  );
  assert.match(hook, /if \(!loaded\.has\(annotation\.anchor\)\) continue;/);
  assert.equal(hook.match(/querySelectorAll/g).length, 1);
});

test("the layer is keyed by the canonical document id, not the display citation", () => {
  assert.match(
    judgmentPage,
    /<JudgmentBody\s+citation=\{decoded\}\s+docId=\{decoded\}/,
  );
  assert.match(judgmentPage, /<SelectionTools[\s\S]*?docId=\{decoded\}/);
  assert.match(judgmentBody, /const annotationDocId = docId \?\? citation;/);
  assert.match(
    judgmentBody,
    /<DocumentAnnotations\s+containerRef=\{containerRef\}\s+docType="judgment"\s+docId=\{annotationDocId\}/,
  );
  assert.match(statutePage, /<StatuteSectionShell\s+docId=\{decoded\}/);
  assert.match(statutePage, /<SelectionTools[\s\S]*?docId=\{decoded\}/);
  assert.match(
    statuteShell,
    /<DocumentAnnotations\s+containerRef=\{containerRef\}\s+docType="statute"\s+docId=\{docId\}/,
  );
});
