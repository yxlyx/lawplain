/**
 * The selection toolbar must be visible wherever the passage is.
 *
 * Reported as "the highlight/note buttons don't come up". They did come up — they
 * rendered behind the sticky site header, which is 57px tall and also z-40. Only
 * the horizontal position was clamped, so a selection near the top of the
 * viewport put the bar at top=25 with the header's own div returned by
 * elementFromPoint at its centre.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/components/SelectionTools.tsx", "utf8");

test("the bar flips below the selection when it will not clear the header", () => {
  assert.match(
    source,
    /function placeBar\(box: \{ top: number; bottom: number \}\)/,
  );
  assert.match(
    source,
    /const fitsAbove = box\.top - PANEL_GAP - BAR_HEIGHT >= HEADER_SAFE_TOP/,
  );
  // Above when it fits; below, never above the header, when it does not.
  assert.match(source, /\{ top: box\.top - 10, below: false \}/);
  assert.match(
    source,
    /\{ top: Math\.max\(box\.bottom \+ PANEL_GAP, HEADER_SAFE_TOP\), below: true \}/,
  );
});

test("the header's height is recorded, not guessed at the call site", () => {
  assert.match(source, /const HEADER_SAFE_TOP = 64;/);
  assert.match(source, /const BAR_HEIGHT = 44;/);
  assert.match(source, /sticky top-0 z-40. and 57px tall/);
});

test("placement drives both the offset and the transform", () => {
  assert.match(source, /const placement = placeBar\(box\);/);
  assert.match(source, /top: placement\.top,/);
  assert.match(source, /below: placement\.below,/);
  // The upward transform only applies when the bar sits above the selection.
  assert.match(source, /rect\.below \? "" : "-translate-y-full"/);
});

test("the bar outranks the header it used to hide behind", () => {
  assert.match(source, /motion-fade-up fixed z-50/);
  assert.doesNotMatch(source, /motion-fade-up fixed z-40/);
});

test("the panel height is measured from where the bar actually lands", () => {
  // Measuring from the old, unclamped position would cap the palette wrongly
  // whenever the bar flipped below the selection.
  assert.match(source, /panelHeightBelow\(placement\.top\)/);
  assert.doesNotMatch(source, /panelHeightBelow\(box\.top - 10\)/);
});
