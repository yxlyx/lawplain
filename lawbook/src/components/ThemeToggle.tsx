"use client";

import { useEffect, useState } from "react";

const THEME_STORAGE_KEY = "lawplain:theme";
type Theme = "light" | "dark";

function readStoredTheme(): Theme {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === "dark"
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  const isDark = theme === "dark";
  const nextThemeLabel = isDark
    ? "Switch to light mode"
    : "Switch to dark mode";

  useEffect(() => {
    const storedTheme = readStoredTheme();
    setTheme(storedTheme);
    applyTheme(storedTheme);
  }, []);

  const toggleTheme = () => {
    const nextTheme: Theme = isDark ? "light" : "dark";
    setTheme(nextTheme);
    applyTheme(nextTheme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // Keep the current theme for this session when persistence is unavailable.
    }
  };

  return (
    <button
      type="button"
      aria-label={nextThemeLabel}
      aria-pressed={isDark}
      title={nextThemeLabel}
      onClick={toggleTheme}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-2 transition-colors hover:bg-surface-2 hover:text-foreground"
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" />
      </svg>
      <span className="sr-only">{nextThemeLabel}</span>
    </button>
  );
}
