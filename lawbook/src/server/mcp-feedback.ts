import { z } from "zod";

export const mcpFeedbackSchema = z
  .object({
    activityId: z.string().uuid(),
    rating: z.enum(["helpful", "not_helpful"]).nullable(),
    comment: z.string().trim().max(2000).optional(),
    sharedAnswer: z.string().trim().max(12000).optional(),
  })
  .strict();

export type McpFeedback = z.infer<typeof mcpFeedbackSchema>;

/** Best-effort protection for accidentally pasted credentials, not a PII filter. */
export function redactMcpText(text: string): string {
  return text
    .replace(/lp_live_[a-f0-9]{48}/gi, "[redacted key]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, "[redacted key]");
}
