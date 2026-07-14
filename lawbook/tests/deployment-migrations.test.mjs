import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

test("Cloudflare deploy applies remote D1 migrations first", () => {
  const command = packageJson.scripts["cf:deploy"];

  assert.equal(
    command,
    "npm run d1:migrate:remote && npm run d1:migrate:trajectories:remote && opennextjs-cloudflare deploy",
  );
});
