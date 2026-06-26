import { getAuthDb } from "@/lib/d1";
import {
  getSuggestions,
  isSuggestionDocType,
  normalizeSuggestionTerm,
} from "@/lib/suggestions";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const docType = url.searchParams.get("docType") ?? "";
  const docId = url.searchParams.get("docId") ?? "";
  const term = normalizeSuggestionTerm(url.searchParams.get("term") ?? "");

  if (!isSuggestionDocType(docType) || !docId.trim() || !term) {
    return Response.json(
      { error: "Expected docType, docId, and term." },
      { status: 400 },
    );
  }

  const db = await getAuthDb();
  const result = await getSuggestions({ db, docType, docId, term });

  return Response.json(result, {
    headers: {
      "cache-control": "public, max-age=300, s-maxage=300",
    },
  });
}
