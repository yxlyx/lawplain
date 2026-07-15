export interface ToolSummary {
  key: string;
  summary: string;
  kind: "search" | "detail" | "setup" | "other";
}

function parseUrlSafe(raw: string | undefined): URL | null {
  if (!raw) return null;
  try {
    return new URL(raw.replace(/["')]+$/, ""));
  } catch {
    return null;
  }
}

function commandParams(cmd: string, url: URL | null): URLSearchParams {
  const params = new URLSearchParams(url?.search ?? "");
  const encodedArgs = cmd.matchAll(
    /--data-urlencode(?:=|\s+)(?:"([^"]*)"|'([^']*)'|([^\s|;&]+))/g,
  );
  for (const match of encodedArgs) {
    const value = match[1] ?? match[2] ?? match[3] ?? "";
    const separator = value.indexOf("=");
    if (separator <= 0) continue;
    params.set(value.slice(0, separator), value.slice(separator + 1));
  }
  return params;
}

function canonicalParams(params: URLSearchParams): string {
  return [...params.entries()]
    .sort(([ak, av], [bk, bv]) =>
      ak === bk ? av.localeCompare(bv) : ak.localeCompare(bk),
    )
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join("&");
}

/** Best-effort semantic summary of an agent tool call for UI and telemetry. */
export function summarizeToolCall(name: string, input: unknown): ToolSummary {
  const inp =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  if (name === "bash") {
    const cmd = String(inp.command ?? "").trim();
    const urlRaw = cmd.match(/https?:\/\/[^\s"')]+/)?.[0];
    const url = parseUrlSafe(urlRaw);
    const params = commandParams(cmd, url);
    const q = params.get("q");
    const endpoint = url?.pathname ?? "unknown-search";
    const query = canonicalParams(params);

    if (q) {
      return {
        key: `bash:${endpoint}${query ? `?${query}` : ""}`,
        summary: `search: ${q} (${endpoint})`,
        kind: "search",
      };
    }

    if (url) {
      return {
        key: `bash:${endpoint}${query ? `?${query}` : ""}`,
        summary: endpoint,
        kind: endpoint.startsWith("/v1/") ? "detail" : "other",
      };
    }

    return {
      key: `bash:${cmd.slice(0, 160)}`,
      summary: cmd.slice(0, 80),
      kind: "other",
    };
  }
  if (name === "webfetch") {
    const url = String(inp.url ?? "");
    return { key: `webfetch:${url}`, summary: `fetch ${url}`, kind: "detail" };
  }
  if (name === "read_file") {
    const path = String(inp.path ?? "");
    return { key: `read_file:${path}`, summary: `read ${path}`, kind: "other" };
  }
  return { key: name, summary: name, kind: "other" };
}
