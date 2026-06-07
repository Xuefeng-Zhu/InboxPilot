/**
 * AiSettings Zod validation + sanitisation helpers.
 *
 * The org settings write path is the admin settings UI in
 * `app/settings/ai/page.tsx`, which writes directly to the `ai_settings`
 * table through the InsForge SDK. There is no server function in the
 * path, so validation that *should* run server-side has to run on the
 * client before the PUT. This module provides:
 *
 *   1. `EscalationKeywordsSchema` — a Zod schema that accepts
 *      `string[]` and rejects empty / whitespace-only entries.
 *   2. `sanitizeEscalationKeywords` — strip-and-dedupe a raw input
 *      array; never throws, returns a clean string[].
 *   3. `validateEscalationKeywords` — strict Zod validation that
 *      surfaces the first failing entry to the caller (used by the
 *      settings UI to show a clear inline error).
 *
 * Why both a Zod schema and a sanitiser?
 * - The Zod schema is the contract: "empty strings are not allowed."
 * - The sanitiser is the safe-by-default behaviour: an admin who
 *   accidentally leaves a blank row gets the blank silently dropped
 *   (no error, just a no-op), which is the right UX for a typo fix.
 *   The Zod schema is reserved for the explicit "rejected input"
 *   case (programmatic POST/PUT from an API consumer).
 *
 * Why this is a Zod schema and not a regex?
 * - Zod gives us typed errors, schema composition, and a place to
 *   grow the validation (max-length per keyword, max array size,
 *   allowed-character regex) without rewriting the call sites.
 * - It mirrors the existing pattern in `ai-decision-parser.ts` so
 *   reviewers can match the style.
 */

import { z } from 'zod';

/**
 * Per-keyword constraints. The `min(1)` enforces non-empty after trim
 * (we apply `.trim()` first via `.transform()` so the validation
 * actually checks the trimmed value, not the raw input). A max length
 * of 200 keeps the array reasonable in the DB and prevents a single
 * admin from pasting a paragraph as a "keyword".
 */
const singleKeywordSchema = z
  .string()
  .max(200, 'Escalation keyword must be 200 characters or fewer')
  .transform((s) => s.trim())
  .refine((s) => s.length > 0, {
    message: 'Escalation keyword must not be empty or whitespace-only',
  });

/**
 * Schema for the full `escalationKeywords` field. A reasonable upper
 * bound on array size keeps the INCLUDES-based evaluation fast
 * (substring scan over the message is O(n*k) where k is the number of
 * keywords; 100 keywords × 200 chars × 1000-char message is still well
 * under a millisecond).
 */
export const EscalationKeywordsSchema = z
  .array(singleKeywordSchema)
  .max(100, 'At most 100 escalation keywords are allowed')
  .transform((arr) => {
    // Case-insensitive dedupe, lowercased (matches how the
    // settings UI already stores keywords).
    const seen = new Set<string>();
    const out: string[] = [];
    for (const k of arr) {
      const lower = k.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        out.push(lower);
      }
    }
    return out;
  });

/** Result type for `validateEscalationKeywords`. */
export type ValidateEscalationKeywordsResult =
  | { success: true; data: string[] }
  | { success: false; error: string };

/**
 * Strict validation. Use this on the settings write path when the
 * caller wants to surface validation errors to the user. Lowercases
 * and dedupes the input as part of normalisation.
 *
 * @example
 *   const r = validateEscalationKeywords(['urgent', '']);
 *   if (!r.success) setError(r.error);
 */
export function validateEscalationKeywords(
  input: unknown,
): ValidateEscalationKeywordsResult {
  const result = EscalationKeywordsSchema.safeParse(input);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    const path = firstIssue?.path.join('.') ?? 'escalationKeywords';
    return {
      success: false,
      error: `${path}: ${firstIssue?.message ?? 'invalid value'}`,
    };
  }
  return { success: true, data: result.data };
}

/**
 * Sanitiser (never throws). Drops empty / whitespace-only entries,
 * lowercases, dedupes. Use this on the write path when the caller
 * would rather silently clean up than reject (e.g. a CSV import
 * that has a few blank rows; the right move is to drop them, not
 * fail the whole import).
 *
 * @example
 *   sanitizeEscalationKeywords(['Urgent', '  ', 'vip', 'urgent']);
 *   // -> ['urgent', 'vip']
 */
export function sanitizeEscalationKeywords(input: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim().toLowerCase();
    if (trimmed.length === 0) continue;
    if (trimmed.length > 200) continue; // silently drop oversize
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
