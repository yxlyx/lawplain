import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("theme toggle is available in the top bar", () => {
  const shell = read("src/components/AppShell.tsx");
  const toggle = read("src/components/ThemeToggle.tsx");

  assert.match(
    shell,
    /import \{ ThemeToggle \} from "@\/components\/ThemeToggle"/,
  );
  assert.match(shell, /<ThemeToggle \/>/);
  assert.match(toggle, /aria-label=\{nextThemeLabel\}/);
  assert.match(toggle, /aria-pressed=\{isDark\}/);
  assert.match(toggle, /<circle cx="12" cy="12" r="4" \/>/);
  assert.doesNotMatch(toggle, /M20\.5 15\.3/);
});

test("theme preference is applied before the app renders and persisted on toggle", () => {
  const layout = read("src/app/layout.tsx");
  const toggle = read("src/components/ThemeToggle.tsx");
  const styles = read("src/app/globals.css");

  assert.match(layout, /localStorage\.getItem\("lawplain:theme"\)/);
  assert.match(layout, /document\.documentElement\.dataset\.theme = theme/);
  assert.match(
    toggle,
    /window\.localStorage\.setItem\(THEME_STORAGE_KEY, nextTheme\)/,
  );
  assert.match(styles, /\[data-theme="dark"\]/);
  assert.match(styles, /--background: #101318/);
});
