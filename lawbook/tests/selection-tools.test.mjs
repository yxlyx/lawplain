import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const selectionTools = read("src/components/SelectionTools.tsx");
const annotationLabels = read("src/lib/annotation-labels.ts");
const judgmentPage = read("src/app/judgment/[citation]/page.tsx");
const statutePage = read("src/app/statute/[reference]/page.tsx");
const documentPage = read("src/app/document/[kind]/[id]/page.tsx");
const savedQuoteTarget = read("src/hooks/useSavedQuoteTarget.ts");

/** The palette markup, from the first swatch to the end of the palette group. */
const paletteMarkup = selectionTools.slice(
  selectionTools.indexOf("{ANNOTATION_LABELS.map((label, index) => ("),
  selectionTools.indexOf("</fieldset>"),
);
/** The note editor's label picker, which starts after the palette. */
const notePickerMarkup = selectionTools.slice(
  selectionTools.indexOf("{ANNOTATION_LABELS.map((label) => {"),
);

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

test("every preset label is offered by name, never by colour alone", () => {
  const presetNames = [...annotationLabels.matchAll(/name: "([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.ok(presetNames.length >= 7, "the case-reading preset is populated");

  // Both pickers walk the whole preset, so no label can be quietly dropped.
  assert.doesNotMatch(selectionTools, /ANNOTATION_LABELS\.(slice|filter)\(/);
  assert.match(paletteMarkup, /\{label\.name\}/);
  assert.match(paletteMarkup, /\{label\.hint\}/);
  assert.match(notePickerMarkup, /\{label\.name\}/);

  // Colour comes from the shared custom properties and is hidden from assistive
  // technology, so the name is the only thing carrying the label's meaning.
  assert.match(
    selectionTools,
    /backgroundColor: `var\(--annotation-\$\{token\}\)`,\s+borderColor: `var\(--annotation-\$\{token\}-ink\)`/,
  );
  assert.match(
    paletteMarkup,
    /aria-hidden="true"[\s\S]*?style=\{labelSwatchStyle\(label\.id\)\}/,
  );
  assert.match(
    notePickerMarkup,
    /aria-hidden="true"[\s\S]*?style=\{labelSwatchStyle\(label\.id\)\}/,
  );
});

test("annotations are posted with the label the reader chose", () => {
  assert.match(
    selectionTools,
    /async function saveAnnotation\(privateNote: string \| null, labelId: string\)/,
  );
  assert.match(
    selectionTools,
    /body: JSON\.stringify\(\{[\s\S]*?note: privateNote,\s+label: labelId,\s*\}\)/,
  );
  // A swatch saves immediately with its own label; the editor saves the picked one.
  assert.match(paletteMarkup, /void saveAnnotation\(null, label\.id\)/);
  assert.match(selectionTools, /void saveAnnotation\(note, noteLabelId\)/);
  assert.match(
    selectionTools,
    /const \[noteLabelId, setNoteLabelId\] = useState\(DEFAULT_ANNOTATION_LABEL_ID\)/,
  );
  // Repeated clicks cannot write a second annotation for the same passage.
  assert.match(
    selectionTools,
    /if \(!draft \|\| !askKind \|\| saving \|\| saved\) return;/,
  );
  assert.match(paletteMarkup, /disabled=\{saved \|\| saving\}/);
});

test("opening the palette or the note editor moves focus into it", () => {
  assert.match(
    selectionTools,
    /if \(paletteOpen\) firstSwatchRef\.current\?\.focus\(\);\s*\}, \[paletteOpen\]\)/,
  );
  assert.match(
    selectionTools,
    /if \(noteOpen\) noteFieldRef\.current\?\.focus\(\);\s*\}, \[noteOpen\]\)/,
  );
  assert.match(
    paletteMarkup,
    /ref=\{index === 0 \? firstSwatchRef : undefined\}/,
  );
  assert.match(
    selectionTools,
    /ref=\{noteFieldRef\}\s+id="selection-private-note"/,
  );
});

test("escape closes the palette or the note editor and restores focus", () => {
  assert.match(
    selectionTools,
    /function closePalette\(\) \{\s+setPaletteOpen\(false\);\s+highlightRef\.current\?\.focus\(\);/,
  );
  assert.match(
    selectionTools,
    /function closeNoteEditor\(\) \{\s+setNoteOpen\(false\);\s+noteButtonRef\.current\?\.focus\(\);/,
  );
  assert.match(
    selectionTools,
    /function onPaletteKeyDown[\s\S]*?event\.key === "Escape"[\s\S]*?closePalette\(\);/,
  );
  assert.match(
    selectionTools,
    /function onNoteKeyDown[\s\S]*?if \(event\.key !== "Escape"\) return;[\s\S]*?closeNoteEditor\(\);/,
  );
  assert.match(selectionTools, /onKeyDown=\{onPaletteKeyDown\}/);
  assert.match(selectionTools, /onKeyDown=\{onNoteKeyDown\}/);
  // Cancel is the pointer equivalent and must restore focus the same way.
  assert.match(selectionTools, /onClick=\{closeNoteEditor\}/);
});

test("the floating bar is a named toolbar and its panels are named groups", () => {
  assert.match(selectionTools, /role="toolbar"\s+aria-label="[^"]+"/);
  assert.match(selectionTools, /onKeyDown=\{onToolbarKeyDown\}/);
  assert.match(
    selectionTools,
    /function onToolbarKeyDown[\s\S]*?"ArrowRight" \? 1 : event\.key === "ArrowLeft" \? -1 : 0/,
  );
  // Each panel is a group named by visible text, and every control is named.
  for (const id of [
    "selection-label-palette-title",
    "selection-note-label-title",
  ]) {
    assert.match(selectionTools, new RegExp(`aria-labelledby="${id}"`));
    assert.match(selectionTools, new RegExp(`id="${id}"`));
  }
  assert.match(
    paletteMarkup,
    /aria-label=\{`Highlight as \$\{label\.name\}`\}/,
  );
  assert.match(notePickerMarkup, /aria-pressed=\{chosen\}/);
  assert.match(selectionTools, /htmlFor="selection-private-note"/);
  assert.match(
    selectionTools,
    /aria-label="Copy quote with citation and link"/,
  );
  assert.match(selectionTools, /aria-expanded=\{paletteOpen\}/);
  assert.match(selectionTools, /aria-expanded=\{noteOpen\}/);
});

test("panels stay on screen when the selection sits at a viewport edge", () => {
  const panelWidth = Number(
    selectionTools.match(/const PANEL_WIDTH = (\d+);/)[1],
  );
  const margin = Number(
    selectionTools.match(/const VIEWPORT_MARGIN = (\d+);/)[1],
  );
  assert.match(
    selectionTools,
    /left: clampToViewport\(box\.left \+ box\.width \/ 2\)/,
  );
  assert.equal(
    selectionTools.match(/max-w-\[calc\(100vw-1\.5rem\)\]/g).length,
    2,
    "the palette and the note editor are both capped to the viewport",
  );

  const start = selectionTools.indexOf("function clampToViewport");
  const source = selectionTools
    .slice(start, selectionTools.indexOf("\n}\n", start) + 2)
    .replace(/: number/g, "");
  const build = new Function(
    "PANEL_WIDTH",
    "VIEWPORT_MARGIN",
    "window",
    `${source}\nreturn clampToViewport;`,
  );

  for (const viewport of [1440, 390, 280]) {
    const clamp = build(panelWidth, margin, { innerWidth: viewport });
    const half = Math.min(panelWidth, Math.max(0, viewport - margin * 2)) / 2;
    for (const centre of [
      -400,
      0,
      12,
      viewport / 2,
      viewport,
      viewport + 400,
    ]) {
      const left = clamp(centre);
      assert.ok(
        left - half >= -0.01 && left + half <= viewport + 0.01,
        `centre ${centre} on a ${viewport}px viewport stays on screen`,
      );
    }
  }
});

test("a panel opening low in the viewport scrolls rather than spilling", () => {
  const gap = Number(selectionTools.match(/const PANEL_GAP = (\d+);/)[1]);
  const margin = Number(
    selectionTools.match(/const VIEWPORT_MARGIN = (\d+);/)[1],
  );
  const minHeight = Number(
    selectionTools.match(/const PANEL_MIN_HEIGHT = (\d+);/)[1],
  );
  // The bar is fixed to the selection, so a panel that overflows downward
  // cannot be scrolled back into view — the panel itself has to scroll.
  assert.equal(
    selectionTools.match(/style=\{\{ maxHeight: rect\.maxPanelHeight \}\}/g)
      .length,
    2,
    "the palette and the note editor are both height-capped",
  );
  assert.equal(
    selectionTools.match(/thin-scroll[^"]*overflow-y-auto/g).length,
    2,
  );

  const start = selectionTools.indexOf("function panelHeightBelow");
  const source = selectionTools
    .slice(start, selectionTools.indexOf("\n}\n", start) + 2)
    .replace(/: number/g, "");
  const height = new Function(
    "PANEL_GAP",
    "VIEWPORT_MARGIN",
    "PANEL_MIN_HEIGHT",
    "window",
    `${source}\nreturn panelHeightBelow;`,
  )(gap, margin, minHeight, { innerHeight: 664 });

  // A selection near the top gets nearly the whole viewport; one near the
  // bottom is floored rather than given a negative or unusable height.
  assert.ok(height(50) > 500);
  assert.equal(height(640), minHeight);
  for (const top of [0, 200, 400, 660, 900]) {
    assert.ok(height(top) >= minHeight, `top ${top} keeps a usable panel`);
    assert.ok(
      top + gap + height(top) <= 664 - margin || height(top) === minHeight,
      `top ${top} fits the viewport unless it hit the floor`,
    );
  }
});

test("unsupported generic documents retain copy without offering a broken save action", () => {
  assert.match(documentPage, /<SelectionTools[\s\S]*?docId=\{decodedId\}/);
  assert.match(selectionTools, /\{askKind &&\s+\(isSignedIn \?/);
  assert.match(
    selectionTools,
    /const canAnnotate = Boolean\(askKind\) && isSignedIn;/,
  );

  const markup = selectionTools.slice(
    selectionTools.lastIndexOf("\n  return ("),
  );
  const gate = markup.indexOf("{canAnnotate && (");
  assert.ok(gate > 0, "annotation surfaces sit behind a canAnnotate gate");
  const always = markup.slice(0, gate);
  const gated = markup.slice(gate);

  // A generic document (no askKind) still renders the toolbar and Copy…
  assert.match(always, /role="toolbar"/);
  assert.match(always, /\{copied \? "Copied" : "Copy"\}/);
  // …and nothing that would call an annotation API it cannot satisfy.
  assert.doesNotMatch(always, /ANNOTATION_LABELS/);
  assert.doesNotMatch(always, /saveAnnotation\(/);
  assert.doesNotMatch(always, /selection-private-note/);
  // The palette, the note editor, and their feedback exist only behind it.
  assert.match(gated, /ANNOTATION_LABELS\.map\(/);
  assert.match(gated, /saveAnnotation\(/);
  assert.match(gated, /selection-private-note/);
  assert.match(gated, /<output/);
  assert.match(gated, /role="alert"/);
});
