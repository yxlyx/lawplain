import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("theme toggle is available in the top bar on desktop and mobile", () => {
  const shell = read("src/components/AppShell.tsx");
  const toggle = read("src/components/ThemeToggle.tsx");
  const icons = read("src/components/icons.tsx");

  assert.match(
    shell,
    /import \{ ThemeToggle \} from "@\/components\/ThemeToggle"/,
  );
  assert.match(shell, /<ThemeToggle \/>/);
  // Header (mobile + desktop) and the mobile drawer, which inerts the header.
  assert.equal([...shell.matchAll(/<ThemeToggle \/>/g)].length, 2);
  assert.match(toggle, /aria-label=\{nextThemeLabel\}/);
  assert.match(toggle, /aria-pressed=\{isDark\}/);
  assert.match(toggle, /<SunIcon /);
  assert.match(icons, /<circle cx="12" cy="12" r="4" \/>/);
  assert.doesNotMatch(toggle, /M20\.5 15\.3/);
  assert.doesNotMatch(icons, /M20\.5 15\.3/);
});

test("theme preference is applied before the app renders and persisted on toggle", () => {
  const layout = read("src/app/layout.tsx");
  const toggle = read("src/components/ThemeToggle.tsx");
  const styles = read("src/app/globals.css");

  assert.match(layout, /localStorage\.getItem\("lawplain:theme"\)/);
  assert.match(layout, /storedTheme === "dark" \|\| storedTheme === "light"/);
  assert.match(
    layout,
    /document\.documentElement\.dataset\.theme = storedTheme/,
  );
  // An absent stored choice must not pin light — #206 still follows the OS.
  assert.doesNotMatch(layout, /storedTheme === "dark" \? "dark" : "light"/);
  assert.match(
    toggle,
    /window\.localStorage\.setItem\(THEME_STORAGE_KEY, nextTheme\)/,
  );
  assert.match(styles, /:root\[data-theme="dark"\]/);
  assert.match(styles, /:root:not\(\[data-theme="light"\]\)/);
});
