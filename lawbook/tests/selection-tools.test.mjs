import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const selectionTools = read("src/components/SelectionTools.tsx");
const judgmentPage = read("src/app/judgment/[citation]/page.tsx");
const statutePage = read("src/app/statute/[reference]/page.tsx");
const documentPage = read("src/app/document/[kind]/[id]/page.tsx");
const savedQuoteTarget = read("src/hooks/useSavedQuoteTarget.ts");

test("saved selections use canonical document IDs rather than display citations", () => {
  assert.match(
    selectionTools,
    /fetch\("\/api\/annotations"[\s\S]*?body: JSON\.stringify\(\{[\s\S]*?docType: askKind,\s+docId,\s+title,/,
  );
  assert.doesNotMatch(selectionTools, /docId:\s*citation/);
  assert.match(
    judgmentPage,
    /<SelectionTools[\s\S]*?docId=\{decoded\}[\s\S]*?askKind="judgment"/,
  );
  assert.match(
    statutePage,
    /<SelectionTools[\s\S]*?docId=\{decoded\}[\s\S]*?askKind="statute"/,
  );
});

test("stale save completion cannot mark a new selection saved", () => {
  assert.match(
    selectionTools,
    /selectionVersion\.current \+= 1;[\s\S]*?setDraft\(/,
  );
  assert.match(
    selectionTools,
    /const requestVersion = selectionVersion\.current;[\s\S]*?if \(requestVersion !== selectionVersion\.current\) return;[\s\S]*?setSaved\(true\)/,
  );
});

test("account transitions invalidate private selection and deep-link state", () => {
  assert.match(selectionTools, /const ownerId = session\?\.user\.id \?\? null/);
  assert.match(selectionTools, /setDraftOwnerId\(ownerIdRef\.current\)/);
  assert.match(selectionTools, /draftOwnerId !== ownerId/);
  assert.match(
    selectionTools,
    /previousOwnerId\.current = ownerId;[\s\S]*selectionVersion\.current \+= 1;[\s\S]*setNote\(""\)/,
  );
  assert.match(savedQuoteTarget, /const ownerId = session\?\.user\.id/);
  assert.match(savedQuoteTarget, /if \(!quoteId \|\| !ownerId\) return/);
  assert.match(savedQuoteTarget, /signal: controller\.signal/);
  assert.match(savedQuoteTarget, /controller\.abort\(\)/);
  assert.match(savedQuoteTarget, /\[containerRef, docType, ownerId, quoteId\]/);
});

test("unsupported generic documents retain copy without offering a broken save action", () => {
  assert.match(documentPage, /<SelectionTools[\s\S]*?docId=\{decodedId\}/);
  assert.match(selectionTools, /\{askKind &&\s+\(isSignedIn \?/);
  assert.doesNotMatch(selectionTools, /@\/lib\/annotation-labels/);
});
