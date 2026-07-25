/**
 * #192 "Rendering is accessible in light/dark themes and does not rely only on colour."
 * #193 "Palette, text, borders, and non-colour indicators meet accessibility
 *       needs in light/dark themes."
 *
 * Computes real WCAG contrast ratios from globals.css, in both themes, so a token
 * cannot be re-tinted into an inaccessible value without this failing. Running it
 * for the first time is what found `--muted-2` sitting at 3.89:1 on the white
 * canvas — under AA, and unrelated to dark mode.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync("src/app/globals.css", "utf8");

/** Body of the rule starting at `index`, matched by brace depth. */
function ruleBody(source, index) {
  const open = source.indexOf("{", index);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}" && --depth === 0)
      return source.slice(open + 1, i);
  }
  return "";
}

function tokens(body) {
  const out = {};
  for (const [, name, value] of body.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) {
    out[name] = value.trim();
  }
  return out;
}

/** Light is every `:root {` rule; dark is the explicit override. */
function theme(kind) {
  if (kind === "dark")
    return tokens(ruleBody(css, css.indexOf(':root[data-theme="dark"] {')));
  const merged = {};
  for (
    let at = css.indexOf(":root {");
    at !== -1;
    at = css.indexOf(":root {", at + 7)
  ) {
    Object.assign(merged, tokens(ruleBody(css, at)));
  }
  return merged;
}

function parse(value) {
  const rgba = value.match(
    /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)/,
  );
  if (rgba)
    return [+rgba[1], +rgba[2], +rgba[3], rgba[4] === undefined ? 1 : +rgba[4]];
  const hex = value.trim().replace("#", "");
  if (hex.length === 6 || hex.length === 8) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
      hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
    ];
  }
  if (hex.length === 3)
    return [0, 1, 2].map((i) => parseInt(hex[i] + hex[i], 16)).concat(1);
  return null;
}

const flatten = (fg, bg) =>
  fg[3] >= 1
    ? fg
    : [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);

function luminance(c) {
  const [r, g, b] = c.slice(0, 3).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fgValue, bgValue) {
  const bg = parse(bgValue);
  const fg = parse(fgValue);
  assert.ok(bg && fg, `could not read colours: ${fgValue} on ${bgValue}`);
  const [hi, lo] = [luminance(flatten(fg, bg)), luminance(bg)].sort(
    (a, b) => b - a,
  );
  return (hi + 0.05) / (lo + 0.05);
}

const LABELS = [
  "key-point",
  "facts",
  "issue",
  "holding",
  "reasoning",
  "exception",
  "follow-up",
  "other",
];

for (const kind of ["light", "dark"]) {
  test(`${kind}: text meets WCAG AA against the canvas it sits on`, () => {
    const t = theme(kind);
    const failures = [];
    const check = (name, fg, bg, need) => {
      const ratio = contrast(fg, bg);
      if (ratio < need)
        failures.push(`${name}: ${ratio.toFixed(2)}:1 (needs ${need})`);
    };
    // AA for normal text is 4.5:1. muted-2 carries dates, counts and meta lines,
    // so it is normal text and gets no large-text discount.
    for (const token of ["--foreground", "--muted", "--muted-2", "--accent"]) {
      check(`${token} on background`, t[token], t["--background"], 4.5);
    }
    check("--muted on surface", t["--muted"], t["--surface"], 4.5);
    check("--muted-2 on surface-2", t["--muted-2"], t["--surface-2"], 4.5);
    // Semantic state text.
    for (const token of ["--danger", "--warning", "--success"]) {
      check(`${token} on background`, t[token], t["--background"], 4.5);
    }
    assert.deepEqual(failures, [], `\n  ${failures.join("\n  ")}`);
  });

  test(`${kind}: every annotation label is legible and its tint perceivable`, () => {
    const t = theme(kind);
    const failures = [];
    for (const label of LABELS) {
      // The ink carries chip text and the highlight underline.
      const ink = contrast(t[`--annotation-${label}-ink`], t["--background"]);
      if (ink < 4.5)
        failures.push(
          `--annotation-${label}-ink: ${ink.toFixed(2)}:1 (needs 4.5)`,
        );
      // The tint must be visible against the page, though it is never the only cue.
      const tint = contrast(t[`--annotation-${label}`], t["--background"]);
      if (tint < 1.15)
        failures.push(
          `--annotation-${label} tint: ${tint.toFixed(2)}:1 (needs 1.15)`,
        );
    }
    assert.deepEqual(failures, [], `\n  ${failures.join("\n  ")}`);
  });

  test(`${kind}: annotation inks stay distinguishable from each other`, () => {
    const t = theme(kind);
    // follow-up and other deliberately share a neutral; the rest must differ.
    const inks = LABELS.filter((l) => l !== "other").map(
      (l) => t[`--annotation-${l}-ink`],
    );
    assert.equal(
      new Set(inks).size,
      inks.length,
      `two labels share an ink in ${kind}: ${inks.join(", ")}`,
    );
  });
}
