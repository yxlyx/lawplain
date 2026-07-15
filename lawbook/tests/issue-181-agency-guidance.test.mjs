import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canonicalSearchSignature,
  canonicalSearchState,
} from "../src/lib/search-state.js";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("guidance search state preserves its corpus and filters", () => {
  const state = canonicalSearchState(
    new URLSearchParams(
      "tab=guidance&q=workplace+fairness&agency=TAFEP&document_kind=guideline",
    ),
  );

  assert.deepEqual(state, {
    tab: "guidance",
    query: "workplace fairness",
    filters: { agency: "TAFEP", document_kind: "guideline" },
  });
  assert.equal(
    canonicalSearchSignature(state.tab, state.query, state.filters),
    "tab=guidance&q=workplace+fairness&agency=TAFEP&document_kind=guideline",
  );
});

test("typed client exposes the distinct agency-guidance corpus", () => {
  const client = read("src/lib/sgjudge.ts");
  assert.match(client, /guidance: "agency-guidance"/);
  assert.match(client, /searchAgencyGuidance/);
  assert.match(client, /"\/v1\/agency-guidance\/search"/);
  for (const field of [
    "guidance_id",
    "agency",
    "document_kind",
    "legal_status",
    "source_url",
  ]) {
    assert.match(client, new RegExp(field));
  }
  assert.match(client, /official_agency_guidance_not_legislation/);
});

test("search UI labels, filters, and links guidance results separately", () => {
  const search = read("src/components/SearchExplorer.tsx");
  assert.match(search, /id: "guidance", label: "Guidance"/);
  assert.match(search, /sgjudge\.searchAgencyGuidance/);
  assert.match(search, /name="agency"/);
  assert.match(search, /name="document_kind"/);
  assert.match(search, /hit\.guidance_id/);
  assert.match(search, /hit\.source_url/);
  assert.match(search, /Official agency guidance — not legislation/);
  assert.match(search, /guidanceLegalStatusLabel\(hit\.legal_status\)/);
});

test("guidance detail page keeps status and an HTTPS official-source link visible", () => {
  const detail = read("src/app/document/[kind]/[id]/page.tsx");
  assert.match(detail, /guidance: "Guidance"/);
  assert.match(detail, /guidanceLegalStatusLabel\(detail\?\.legal_status\)/);
  assert.match(detail, /detail\?\.source_url/);
  assert.match(detail, /url\.protocol !== "https:"/);
  assert.match(detail, /isOfficialGuidanceHost/);
  assert.match(detail, /\.tal\.sg/);
  assert.match(detail, /\.pdpc\.gov\.sg/);
  assert.match(detail, /View official agency source/);
  assert.match(detail, /add\("Legal Status"/);
});

test("guidance participates in search history and recently viewed documents", () => {
  const history = read("src/lib/search-history.ts");
  const recents = read("src/lib/recently-viewed.ts");
  const migration = read("migrations/0019_expand_recently_viewed_guidance.sql");
  assert.match(history, /"guidance"/);
  assert.match(recents, /"guidance"/);
  assert.match(migration, /'guidance'/);
  assert.match(migration, /INSERT INTO recently_viewed_documents_new/);
});

test("user-facing docs explain that guidance is not legislation", () => {
  for (const path of ["README.md", "src/app/faq/page.tsx"]) {
    const source = read(path);
    assert.match(source, /not legislation/i);
    assert.match(source, /official\s+(agency\s+)?(source|website)/i);
  }
});

test("Ask retrieves complete guidance and distinguishes it from binding law", () => {
  const agent = read("src/lib/agent.ts");
  assert.match(agent, /AGENCY GUIDANCE FAST PATH/);
  assert.match(
    agent,
    /\/v1\/agency-guidance\/search\?q=&agency=&document_kind=&limit=/,
  );
  assert.match(agent, /include_body=true&body_length=12000/);
  assert.match(agent, /Fetch exactly one best matching/);
  assert.match(agent, /Do not substitute a similarly named statute/);
  assert.match(agent, /Never call agency guidance legislation/);
  assert.match(agent, /primary law controls/);
  assert.match(agent, /\/document\/guidance\/\{guidance_id\}/);
});
