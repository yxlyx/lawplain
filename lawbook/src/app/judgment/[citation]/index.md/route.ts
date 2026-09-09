import { judgmentTextResponse } from "@/lib/judgment-text-response";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ citation: string }> },
) {
  const { citation } = await params;
  return judgmentTextResponse(request, citation);
}
