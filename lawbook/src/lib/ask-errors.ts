export const RESEARCH_FAILED =
  "Research could not be completed. Please try again.";
export const RESEARCH_BUSY =
  "Research is busy right now. Please try again in a few minutes.";
export const SIGN_IN_REQUIRED = "Please sign in to use Ask Lawplain.";

/** Status comes from Lawplain's response, never from a provider error body. */
export function askHttpErrorMessage(status: number): string {
  if (status === 401) return SIGN_IN_REQUIRED;
  if (status === 429) return RESEARCH_BUSY;
  return RESEARCH_FAILED;
}
