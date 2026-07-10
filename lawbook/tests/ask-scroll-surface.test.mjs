import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("the whole pane beside history scrolls while chat content stays readable", () => {
  const askPage = read("src/app/ask/page.tsx");
  const threadPage = read("src/app/ask/[id]/page.tsx");
  const agent = read("src/components/AskAgent.tsx");

  for (const page of [askPage, threadPage]) {
    assert.match(
      page,
      /<main className="h-\[calc\(100dvh-3\.5rem\)\] min-h-0 w-full overflow-hidden">/,
    );
    assert.doesNotMatch(page, /<main className="[^"]*max-w-/);
  }

  assert.match(
    agent,
    /ref=\{chatScrollRef\}[\s\S]*className="thin-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain \[scrollbar-gutter:stable\]"/,
  );
  assert.match(
    agent,
    /mx-auto w-full max-w-\[850px\] space-y-6 px-5 py-4 sm:px-8/,
  );
  assert.match(
    agent,
    /shrink-0 bg-background\/90 py-3 backdrop-blur[\s\S]*mx-auto w-full max-w-\[850px\] px-5 sm:px-8/,
  );
  assert.doesNotMatch(agent, /shrink-0 border-t/);
});
