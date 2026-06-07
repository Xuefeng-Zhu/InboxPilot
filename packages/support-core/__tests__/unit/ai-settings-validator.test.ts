/**
 * Unit tests for the AI settings Zod validator + sanitiser.
 *
 * Covers:
 * - validateEscalationKeywords: success path, empty-string rejection,
 *   whitespace-only rejection, dedupe, max length, max array size.
 * - sanitizeEscalationKeywords: drops empty / whitespace, lowercases,
 *   dedupes, drops oversize, never throws on bad input.
 * - EscalationKeywordsSchema: direct Zod schema test.
 *
 * Bug context: see t_cd438c93 — an empty-string keyword in
 * escalationKeywords caused KeywordRule to escalate EVERY message
 * (String.prototype.includes('') === true in JavaScript). The fix is
 * to filter at both the rule level and the write path.
 */

import { describe, it, expect } from 'vitest';
import {
  EscalationKeywordsSchema,
  validateEscalationKeywords,
  sanitizeEscalationKeywords,
} from '../../src/services/ai-settings-validator.js';

describe('EscalationKeywordsSchema (Zod)', () => {
  it('accepts a normal list of keywords', () => {
    const result = EscalationKeywordsSchema.safeParse(['urgent', 'vip']);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(['urgent', 'vip']);
    }
  });

  it('rejects an empty string', () => {
    const result = EscalationKeywordsSchema.safeParse(['']);
    expect(result.success).toBe(false);
  });

  it('rejects a whitespace-only string', () => {
    const result = EscalationKeywordsSchema.safeParse(['   ']);
    expect(result.success).toBe(false);
  });

  it('rejects a tab/newline string', () => {
    const result = EscalationKeywordsSchema.safeParse(['\t\n']);
    expect(result.success).toBe(false);
  });

  it('rejects a non-string entry', () => {
    const result = EscalationKeywordsSchema.safeParse([42 as unknown as string]);
    expect(result.success).toBe(false);
  });

  it('rejects a keyword longer than 200 characters', () => {
    const result = EscalationKeywordsSchema.safeParse(['a'.repeat(201)]);
    expect(result.success).toBe(false);
  });

  it('rejects an array with more than 100 keywords', () => {
    const result = EscalationKeywordsSchema.safeParse(
      Array.from({ length: 101 }, (_, i) => `kw${i}`),
    );
    expect(result.success).toBe(false);
  });

  it('trims whitespace around a valid keyword', () => {
    const result = EscalationKeywordsSchema.safeParse(['  urgent  ']);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(['urgent']);
    }
  });

  it('lowercases keywords', () => {
    const result = EscalationKeywordsSchema.safeParse(['URGENT', 'ViP']);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(['urgent', 'vip']);
    }
  });

  it('dedupes case-insensitively while preserving first-seen order', () => {
    const result = EscalationKeywordsSchema.safeParse(['Urgent', 'vip', 'URGENT', 'Vip']);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(['urgent', 'vip']);
    }
  });

  it('accepts an empty array (no keywords configured is a valid state)', () => {
    const result = EscalationKeywordsSchema.safeParse([]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
    }
  });
});

describe('validateEscalationKeywords (strict, surfaces errors)', () => {
  it('returns success and lowercased/deduped data for a normal list', () => {
    const r = validateEscalationKeywords(['Urgent', 'vip', 'URGENT']);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toEqual(['urgent', 'vip']);
    }
  });

  it('returns error when an empty string is present', () => {
    const r = validateEscalationKeywords(['urgent', '']);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.toLowerCase()).toContain('empty');
    }
  });

  it('returns error when a whitespace-only entry is present', () => {
    const r = validateEscalationKeywords(['   ']);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.toLowerCase()).toContain('whitespace');
    }
  });

  it('returns error when input is not an array', () => {
    const r = validateEscalationKeywords('not an array');
    expect(r.success).toBe(false);
  });

  it('returns error when a keyword exceeds 200 characters', () => {
    const r = validateEscalationKeywords(['a'.repeat(250)]);
    expect(r.success).toBe(false);
  });
});

describe('sanitizeEscalationKeywords (lenient, never throws)', () => {
  it('drops empty and whitespace-only entries', () => {
    expect(sanitizeEscalationKeywords(['', 'urgent', '   ', '\t'])).toEqual(['urgent']);
  });

  it('lowercases and trims', () => {
    expect(sanitizeEscalationKeywords(['  URGENT  ', 'Vip'])).toEqual(['urgent', 'vip']);
  });

  it('dedupes case-insensitively', () => {
    expect(sanitizeEscalationKeywords(['Urgent', 'urgent', 'URGENT'])).toEqual(['urgent']);
  });

  it('returns an empty array for an all-empty input', () => {
    expect(sanitizeEscalationKeywords(['', '   ', '\t\n'])).toEqual([]);
  });

  it('drops oversize entries silently', () => {
    expect(sanitizeEscalationKeywords(['a'.repeat(250), 'ok'])).toEqual(['ok']);
  });

  it('ignores non-string entries silently', () => {
    // Cast through unknown to satisfy TS at the call site; the
    // sanitiser should defensively skip non-strings.
    expect(
      sanitizeEscalationKeywords([
        'urgent',
        42 as unknown as string,
        null as unknown as string,
        undefined as unknown as string,
        'vip',
      ]),
    ).toEqual(['urgent', 'vip']);
  });

  it('handles an empty array', () => {
    expect(sanitizeEscalationKeywords([])).toEqual([]);
  });

  it('preserves order of first-seen entries', () => {
    expect(
      sanitizeEscalationKeywords(['c', 'a', 'b', 'a', 'c']),
    ).toEqual(['c', 'a', 'b']);
  });
});
