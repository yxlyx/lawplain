import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("production Ask runs persist inputs, events, outputs, and terminal state", () => {
  const route = read("src/app/api/ask/route.ts");
  const durableObject = read("src/server/ask-run-do.ts");
  const store = read("src/server/trajectory-store.ts");

  assert.match(
    route,
    /body: JSON\.stringify\(\{[\s\S]*runId,[\s\S]*question,[\s\S]*cite,/,
  );
  assert.match(durableObject, /TRAJECTORY_DB\?: D1Database/);
  assert.match(durableObject, /startTrajectory\(this\.env\.TRAJECTORY_DB/);
  assert.match(
    durableObject,
    /recordTrajectoryEvents\([\s\S]*trajectoryEvents/,
  );
  assert.match(durableObject, /finishTrajectory\(this\.env\.TRAJECTORY_DB/);
  assert.match(store, /INSERT OR IGNORE INTO ask_trajectories/);
  assert.match(store, /INSERT OR IGNORE INTO ask_trajectory_events/);
  assert.match(store, /SET output = \?, outputEventSeq = \?, status = 'done'/);
});

test("trajectory D1 has an isolated binding and migration directory", () => {
  const wrangler = read("wrangler.jsonc");
  const migration = read("trajectory-migrations/0001_ask_trajectories.sql");

  assert.match(wrangler, /"binding": "TRAJECTORY_DB"/);
  assert.match(wrangler, /"migrations_dir": "trajectory-migrations"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ask_trajectories/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS ask_trajectory_events/);
  assert.match(migration, /output TEXT NOT NULL DEFAULT ''/);
  assert.match(migration, /PRIMARY KEY \(runId, seq\)/);
});

test("completed Ask answers accept ratings and bounded feedback reasons", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(read("trajectory-migrations/0001_ask_trajectories.sql"));
  db.exec(read("trajectory-migrations/0002_ask_trajectory_ratings.sql"));
  db.exec(
    read("trajectory-migrations/0003_ask_trajectory_feedback_reasons.sql"),
  );
  db.prepare(
    `INSERT INTO ask_trajectories
      (runId, userId, question, prompt, model, status, startedAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, 'done', ?, ?)`,
  ).run("run-1", "owner", "question", "prompt", "model", 1, 1);

  db.prepare(
    `UPDATE ask_trajectories
     SET rating = 'not_helpful', ratedAt = 2,
         feedbackReason = 'The answer missed the key exception.',
         feedbackReasonAt = 3
     WHERE runId = ? AND userId = ? AND status = 'done'`,
  ).run("run-1", "owner");
  const saved = db
    .prepare(
      `SELECT rating, ratedAt, feedbackReason, feedbackReasonAt
       FROM ask_trajectories WHERE runId = 'run-1'`,
    )
    .get();
  assert.equal(saved.rating, "not_helpful");
  assert.equal(saved.ratedAt, 2);
  assert.equal(saved.feedbackReason, "The answer missed the key exception.");
  assert.equal(saved.feedbackReasonAt, 3);
  assert.throws(() =>
    db.prepare("UPDATE ask_trajectories SET rating = 'five-stars'").run(),
  );
  assert.throws(() =>
    db
      .prepare("UPDATE ask_trajectories SET feedbackReason = ?")
      .run("x".repeat(1001)),
  );
});

test("Ask feedback API and UI bind ratings to the authenticated run owner", () => {
  const route = read("src/app/api/ask/feedback/route.ts");
  const store = read("src/server/trajectory-store.ts");
  const ui = read("src/components/AskAgent.tsx");

  assert.match(route, /getSession\(req\.headers\)/);
  assert.match(route, /userId: session\.user\.id/);
  assert.match(route, /export async function PATCH/);
  assert.match(route, /reason\.length <= 1000/);
  assert.doesNotMatch(route, /body\?\.userId|body\.userId/);
  assert.match(store, /WHERE runId = \? AND userId = \? AND status = 'done'/);
  assert.match(store, /AND rating = 'not_helpful'/);
  assert.match(ui, /runId: m\.runId/);
  assert.match(ui, /aria-pressed=\{rating === "helpful"\}/);
  assert.match(ui, /aria-pressed=\{rating === "not_helpful"\}/);
  assert.match(ui, /body: JSON\.stringify\(\{ runId, rating: desired \}\)/);
  assert.match(ui, /method: "PATCH"/);
  assert.match(ui, /maxLength=\{1000\}/);
  assert.match(ui, /What could be better\?/);
});
