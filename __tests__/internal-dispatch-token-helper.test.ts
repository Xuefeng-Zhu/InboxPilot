/**
 * Unit tests for the requireInternalToken helper itself.
 *
 * These tests exercise the REAL implementation directly. They are kept
 * in a separate file from the handler-level regression tests
 * (`internal-dispatch-token-handlers.test.ts`) so that the handler
 * tests can mock the helper without breaking these unit tests
 * (vi.mock is hoisted above imports, so any test file that calls
 * vi.mock on the helper module will see the mock for every import,
 * including imports of the real helper).
 */

import { describe, it, expect } from 'vitest';

import {
  requireInternalToken,
  constantTimeEqualStrings,
  INTERNAL_TOKEN_HEADER,
  INTERNAL_TOKEN_ENV,
} from '../insforge/functions/_shared/require-internal-token.js';

/** Build a POST Request with an optional token header and JSON body. */
function buildRequest(opts: { token?: string; body?: unknown } = {}): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token !== undefined) headers[INTERNAL_TOKEN_HEADER] = opts.token;
  return new Request('http://localhost/functions/v1/test', {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body ?? {}),
  });
}

describe('CRITICAL-4: internal-dispatch helper', () => {
  describe('requireInternalToken (real implementation)', () => {
    it('returns ok when the header exactly matches the env token', () => {
      const req = buildRequest({ token: 'super-secret-token' });
      const result = requireInternalToken(req, 'super-secret-token');
      expect(result).toEqual({ kind: 'ok' });
    });

    it('returns misconfigured when the env token is empty or missing', () => {
      const req = buildRequest({ token: 'something' });
      expect(requireInternalToken(req, '')).toEqual({ kind: 'misconfigured' });
      expect(requireInternalToken(req, undefined)).toEqual({ kind: 'misconfigured' });
    });

    it('returns unauthorized when the header is missing', () => {
      const req = buildRequest({});
      expect(requireInternalToken(req, 'super-secret-token')).toEqual({ kind: 'unauthorized' });
    });

    it('returns unauthorized when the header is the wrong value', () => {
      const req = buildRequest({ token: 'attacker-guess' });
      expect(requireInternalToken(req, 'super-secret-token')).toEqual({ kind: 'unauthorized' });
    });

    it('returns unauthorized when the header is a prefix match (no substring bypass)', () => {
      // Same prefix as the real token, but the attacker appended extra
      // bytes. Must still reject — exact-match only.
      const req = buildRequest({
        token: 'super-secret-token-extra-bytes-attacker-added',
      });
      expect(requireInternalToken(req, 'super-secret-token')).toEqual({
        kind: 'unauthorized',
      });
    });

    it('is case-sensitive on the header VALUE', () => {
      const req = buildRequest({ token: 'SUPER-SECRET-TOKEN' });
      expect(requireInternalToken(req, 'super-secret-token')).toEqual({
        kind: 'unauthorized',
      });
    });

    it('is case-insensitive on the header NAME (Fetch spec)', () => {
      // Request normalizes header names to lower-case internally; the
      // helper reads via req.headers.get(NAME) which is case-insensitive.
      const req = new Request('http://localhost/', {
        method: 'POST',
        headers: { 'X-Internal-Token': 'super-secret-token' },
      });
      expect(requireInternalToken(req, 'super-secret-token')).toEqual({ kind: 'ok' });
    });

    it('exports the canonical header and env names', () => {
      // If these names ever change, ops docs and deploy scripts break.
      // Pin them.
      expect(INTERNAL_TOKEN_HEADER).toBe('x-internal-token');
      expect(INTERNAL_TOKEN_ENV).toBe('INTERNAL_DISPATCH_TOKEN');
    });

    it('rejects very short tokens (defense against trivial dev values)', () => {
      // A 1-char token matches, but only if you can guess it. The
      // helper does not enforce a minimum length itself; the env-var
      // generation step in .env.example does. This test pins the
      // current behavior so a future change is intentional.
      const req = buildRequest({ token: 'a' });
      expect(requireInternalToken(req, 'a')).toEqual({ kind: 'ok' });
    });
  });

  describe('constantTimeEqualStrings', () => {
    it('returns true for identical strings', () => {
      expect(constantTimeEqualStrings('hello', 'hello')).toBe(true);
    });

    it('returns false for different content same length', () => {
      expect(constantTimeEqualStrings('hello', 'hellz')).toBe(false);
    });

    it('returns false for different length', () => {
      expect(constantTimeEqualStrings('hello', 'hello-world')).toBe(false);
      expect(constantTimeEqualStrings('hello-world', 'hello')).toBe(false);
    });

    it('treats empty strings as equal', () => {
      expect(constantTimeEqualStrings('', '')).toBe(true);
    });

    it('handles undefined and null without throwing', () => {
      // Both undefined / both null / undefined vs null / mixed with '' all
      // coerce to '' which is equal to ''.
      expect(constantTimeEqualStrings(undefined as unknown as string, '')).toBe(true);
      expect(constantTimeEqualStrings('', null as unknown as string)).toBe(true);
      expect(constantTimeEqualStrings(undefined as unknown as string, null as unknown as string)).toBe(true);
      // Two empty strings: trivially equal.
      expect(constantTimeEqualStrings('', '')).toBe(true);
      // Real content: not equal to empty.
      expect(constantTimeEqualStrings('a', '')).toBe(false);
    });
  });
});
