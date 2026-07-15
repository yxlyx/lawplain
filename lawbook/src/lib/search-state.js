export const SEARCH_FILTER_KEYS = [
  "court",
  "year_range",
  "judge",
  "kind",
  "speaker",
  "since",
  "agency",
  "document_kind",
];

export const SEARCH_TABS = [
  "judgments",
  "statutes",
  "hansard",
  "bills",
  "subsidiary",
  "practice",
  "guidance",
];

export function canonicalSearchState(params) {
  const requestedTab = params.get("tab");
  const filters = {};
  for (const key of SEARCH_FILTER_KEYS) {
    const value = params.get(key)?.trim();
    if (value) filters[key] = value;
  }
  return {
    tab: SEARCH_TABS.includes(requestedTab) ? requestedTab : "judgments",
    query: params.get("q")?.trim() ?? "",
    filters,
  };
}

export function canonicalSearchParams(tab, query, filters) {
  const params = new URLSearchParams();
  params.set("tab", SEARCH_TABS.includes(tab) ? tab : "judgments");
  const cleanQuery = query.trim();
  if (cleanQuery) params.set("q", cleanQuery);
  for (const key of SEARCH_FILTER_KEYS) {
    const value = filters[key]?.trim();
    if (value) params.set(key, value);
  }
  return params;
}

export function canonicalSearchSignature(tab, query, filters) {
  return canonicalSearchParams(tab, query, filters).toString();
}

export function canonicalFilterFields(filters, visibleNames = []) {
  const visible = new Set(visibleNames);
  return SEARCH_FILTER_KEYS.flatMap((name) => {
    const value = filters[name]?.trim();
    return value && !visible.has(name) ? [{ name, value }] : [];
  });
}
