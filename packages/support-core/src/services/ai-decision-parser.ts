/**
 * AI_Decision JSON schema and parser.
 *
 * Uses Zod to define and validate the structured JSON response expected
 * from the LLM. The parser returns a discriminated result: either a
 * successfully parsed decision or an error string.
 */

import { z } from 'zod';

// ─── Zod Schema ──────────────────────────────────────────────────────

export const AiDecisionSchema = z.object({
  decision_type: z.enum(['respond', 'escalate', 'clarify']),
  confidence: z.number().min(0).max(1),
  reasoning_summary: z.string(),
  response_text: z.string().nullable(),
  tags: z.array(z.string()),
  requires_human: z.boolean(),
});

// ─── Parsed Type ─────────────────────────────────────────────────────

export type ParsedAiDecision = z.infer<typeof AiDecisionSchema>;

// ─── Result Type ─────────────────────────────────────────────────────

export type ParseAiDecisionResult =
  | { success: true; data: ParsedAiDecision }
  | { success: false; error: string };

// ─── Parser ──────────────────────────────────────────────────────────

/**
 * Parse a raw JSON string into a validated AI_Decision.
 *
 * Returns `{ success: true, data }` on valid input, or
 * `{ success: false, error }` when the string is not valid JSON
 * or does not conform to the AI_Decision schema.
 */
export function parseAiDecision(raw: string): ParseAiDecisionResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return { success: false, error: 'Invalid JSON: failed to parse input string' };
  }

  const result = AiDecisionSchema.safeParse(parsed);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    return { success: false, error: `Schema validation failed: ${issues}` };
  }

  return { success: true, data: result.data };
}
