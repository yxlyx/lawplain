import { cache } from "react";
import { COLLECTIONS } from "./collections";
import { type SearchResponse, sgjudge } from "./sgjudge";

export const collectionResults = cache(async (slug: string) => {
  const c = COLLECTIONS.find((c) => c.slug === slug);
  if (!c) return [];
  const opts = { limit: 12 };
  const init = {
    next: { revalidate: 86400 },
    signal: AbortSignal.timeout(5000),
  };
  let data: SearchResponse;
  try {
    switch (c.tab) {
      case "judgments":
        data = await sgjudge.searchJudgments(c.query, opts, init);
        break;
      case "statutes":
        data = await sgjudge.searchStatutes(c.query, opts, init);
        break;
      case "hansard":
        data = await sgjudge.searchHansard(c.query, opts, init);
        break;
      case "guidance":
        data = await sgjudge.searchAgencyGuidance(c.query, opts, init);
        break;
      case "bills":
        data = await sgjudge.searchBills(c.query, opts, init);
        break;
      case "subsidiary":
        data = await sgjudge.searchSubsidiary(c.query, opts, init);
        break;
      case "practice":
        data = await sgjudge.searchPracticeDirections(c.query, opts, init);
        break;
    }
  } catch {
    return [];
  }
  const keys: Record<string, string> = {
    judgments: "citation",
    statutes: "act_id",
    hansard: "speech_id",
    guidance: "guidance_id",
    bills: "bill_id",
    subsidiary: "sl_id",
    practice: "pd_id",
  };
  const seen = new Set<string>();
  return data.results.flatMap((hit) => {
    const id = hit[keys[c.tab]];
    if (typeof id !== "string" || !id || seen.has(id)) return [];
    seen.add(id);
    const title = [
      hit.title,
      hit.short_title,
      hit.topic,
      hit.neutral_cite,
      id,
    ].find((v) => typeof v === "string" && v.trim()) as string;
    const path =
      c.tab === "judgments"
        ? `/judgment/${encodeURIComponent(id)}`
        : c.tab === "statutes"
          ? `/statute/${encodeURIComponent(id)}`
          : `/document/${c.tab}/${encodeURIComponent(id)}`;
    return [
      {
        path,
        title,
        label: String(hit.neutral_cite || hit.agency || hit.date || c.title),
      },
    ];
  });
});
