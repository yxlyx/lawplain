import {
  JUDGMENT_TEXT_CHUNK,
  judgmentMarkdown,
  parseTextOffset,
} from "@/lib/judgment-markdown";
import { SITE_ORIGIN } from "@/lib/seo";
import { ApiError, sgjudge } from "@/lib/sgjudge";

export async function judgmentTextResponse(request: Request, citation: string) {
  const offset = parseTextOffset(
    new URL(request.url).searchParams.get("offset"),
  );
  if (offset === null)
    return new Response("Invalid text offset.", { status: 400 });
  if (!citation || citation.length > 200)
    return new Response("Judgment not found.", { status: 404 });
  try {
    const j = await sgjudge.getJudgment(
      citation,
      {
        include_body: true,
        body_offset: offset,
        body_length: JUDGMENT_TEXT_CHUNK,
      },
      { cache: "no-store" },
    );
    if (offset > 0 && offset >= j.body_length)
      return new Response("Text offset is outside this judgment.", {
        status: 416,
      });
    if (!j.body_text && j.body_length > offset)
      return new Response("Judgment text temporarily unavailable.", {
        status: 502,
      });
    const { text, next } = judgmentMarkdown(j, citation, SITE_ORIGIN);
    const canonical = `${SITE_ORIGIN}/judgment/${encodeURIComponent(citation)}`;
    return new Response(text, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "public, max-age=300, s-maxage=3600",
        "X-Content-Type-Options": "nosniff",
        Link: `<${canonical}>; rel="canonical", <${SITE_ORIGIN}/judgment/llms.txt>; rel="describedby"${next ? `, <${next}>; rel="next"` : ""}`,
      },
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404)
      return new Response("Judgment not found.", { status: 404 });
    return new Response(
      "Judgment text temporarily unavailable. Please retry.",
      { status: 502, headers: { "Retry-After": "30" } },
    );
  }
}
