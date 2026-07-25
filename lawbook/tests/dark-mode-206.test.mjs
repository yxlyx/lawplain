/**
 * #206 — dark mode, which #192 and #193 both asked for while globals.css said
 * `color-scheme: light; /* always light *\/`.
 *
 * The part worth guarding is not that a dark block exists, but that nothing
 * escapes it: a single `bg-amber-50` left in a component stays light on a dark
 * canvas, and there were 43 of those.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const css = readFileSync("src/app/globals.css", "utf8");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(path)) out.push(path);
  }
  return out;
}

test("the always-light pin is gone and both theme signals exist", () => {
  assert.doesNotMatch(css, /always light/);
  // Follows the OS...
  assert.match(css, /@media \(prefers-color-scheme: dark\)/);
  // ...but an explicit choice wins, in either direction.
  assert.match(css, /:root\[data-theme="dark"\]/);
  assert.match(css, /:root:not\(\[data-theme="light"\]\)/);
  // color-scheme follows too, so form controls and scrollbars are not left light.
  assert.match(css, /color-scheme: dark;/);
});

test("every token the light theme defines has a dark value", () => {
  // Only colour tokens need a dark counterpart, identified by their value rather
  // than their name — easing curves and the like live in :root too.
  const names = (text) =>
    [...text.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)]
      .filter(([, , value]) => /^(#|rgba?\(|hsla?\()/.test(value.trim()))
      .map((m) => m[1]);

  /** Body of the rule starting at `index`, matched by brace depth. */
  const ruleBody = (source, index) => {
    const open = source.indexOf("{", index);
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}" && --depth === 0)
        return source.slice(open + 1, i);
    }
    return "";
  };

  // Every `:root {` rule, brace-matched so the `@theme inline` alias block that
  // follows is not swallowed — its --color-* names point at these tokens and
  // need no dark value of their own.
  const light = new Set();
  for (
    let at = css.indexOf(":root {");
    at !== -1;
    at = css.indexOf(":root {", at + 7)
  )
    for (const token of names(ruleBody(css, at))) light.add(token);
  const dark = new Set(
    names(ruleBody(css, css.indexOf(':root[data-theme="dark"] {'))),
  );

  const missing = [...light].filter(
    (token) => !dark.has(token) && token !== "--color-scheme",
  );
  assert.deepEqual(
    missing,
    [],
    `these tokens have no dark value, so they stay light on a dark canvas:\n  ${missing.join("\n  ")}`,
  );
});

test("no component keeps a hard-coded palette colour", () => {
  // A Tailwind palette literal cannot follow a theme. Semantic tokens can.
  const literal =
    /\b(?:bg|text|border|ring|from|to)-(?:amber|red|green|blue|yellow|slate|gray|zinc|emerald|orange|purple|pink)-\d{2,3}\b/;
  const offenders = [];
  for (const file of walk("src")) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const hit = line.match(literal);
      if (hit) offenders.push(`${file}: ${hit[0]}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `hard-coded colours will not follow the theme:\n  ${offenders.join("\n  ")}`,
  );
});

test("the annotation inks lighten, so a label is still visible on dark", () => {
  const dark = css.match(/:root\[data-theme="dark"\] \{\n([\s\S]*?)\n\}/)[1];
  // The light theme's inks are dark and would vanish against near-black.
  for (const [token, value] of [
    ["--annotation-key-point-ink", "#fbbf24"],
    ["--annotation-facts-ink", "#60a5fa"],
    ["--annotation-issue-ink", "#c084fc"],
    ["--annotation-holding-ink", "#34d399"],
    ["--annotation-reasoning-ink", "#f472b6"],
    ["--annotation-exception-ink", "#fb923c"],
  ]) {
    assert.match(
      dark,
      new RegExp(`${token}:\\s*${value};`),
      `${token} not lightened`,
    );
  }
  // And they stay distinct from one another, since colour carries meaning here.
  const inks = [
    ...dark.matchAll(/--annotation-[\w-]+-ink:\s*(#[0-9a-f]{6});/g),
  ].map((m) => m[1]);
  const distinct = new Set(inks);
  // follow-up and other share a neutral by design; everything else is unique.
  assert.ok(
    distinct.size >= inks.length - 1,
    `annotation inks collide on dark: ${inks.join(", ")}`,
  );
});
