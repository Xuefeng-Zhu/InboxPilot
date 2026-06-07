import { describe, it, expect } from 'vitest';
import { buildCookieAttributes } from '../lib/auth-context';

/**
 * Tests for HIGH-5 (docs/QA_BUG_HUNT.md): the `insforge_access_token`
 * cookie must be hardened against XSS-leak and CSRF without breaking local
 * development over plain HTTP.
 *
 * Required attributes (launch-blocker):
 *   - SameSite=Strict (strictest available, replaces Lax)
 *   - Secure         (HTTPS-only; conditional on origin in dev)
 *   - HttpOnly       INTENTIONALLY OMITTED (deferred, see comment block in
 *                    lib/auth-context.tsx — the long-term fix is a server-
 *                    side proxy).
 */
describe('buildCookieAttributes (HIGH-5)', () => {
  it('always sets SameSite=Strict', () => {
    const attrsProd = buildCookieAttributes(true);
    const attrsDev = buildCookieAttributes(false);

    expect(attrsProd).toMatch(/SameSite=Strict/);
    expect(attrsDev).toMatch(/SameSite=Strict/);
  });

  it('always sets path=/', () => {
    const attrsProd = buildCookieAttributes(true);
    const attrsDev = buildCookieAttributes(false);

    expect(attrsProd).toMatch(/path=\//);
    expect(attrsDev).toMatch(/path=\//);
  });

  it('adds Secure when the origin is HTTPS (production)', () => {
    const attrs = buildCookieAttributes(true);

    expect(attrs).toMatch(/;\s*Secure/);
  });

  it('omits Secure when the origin is plain HTTP (local dev)', () => {
    // A Secure cookie set over HTTP is silently dropped by the browser,
    // which would break sign-in during development.
    const attrs = buildCookieAttributes(false);

    expect(attrs).not.toMatch(/;\s*Secure/);
  });

  it('does NOT set HttpOnly (deferred launch item)', () => {
    // Documented exception: client code reads this cookie via
    // getAccessToken() to attach a bearer header for function invocations.
    // The long-term fix is a server-side proxy. Until that ships, HttpOnly
    // must remain off or every function-invocation fetch would 401.
    const attrsProd = buildCookieAttributes(true);
    const attrsDev = buildCookieAttributes(false);

    expect(attrsProd).not.toMatch(/HttpOnly/i);
    expect(attrsDev).not.toMatch(/HttpOnly/i);
  });

  it('does not regress to the old SameSite=Lax default', () => {
    // The original implementation used SameSite=Lax, which is what HIGH-5
    // called out as insufficient. Guard against re-introducing it.
    const attrsProd = buildCookieAttributes(true);
    const attrsDev = buildCookieAttributes(false);

    expect(attrsProd).not.toMatch(/SameSite=Lax/);
    expect(attrsDev).not.toMatch(/SameSite=Lax/);
  });

  it('produces a stable, well-formed attribute list (no leading/trailing separators)', () => {
    const attrsProd = buildCookieAttributes(true);
    const attrsDev = buildCookieAttributes(false);

    // Should not start or end with "; " — that's how the caller concatenates
    // it into a `Set-Cookie` style string.
    expect(attrsProd.startsWith('; ')).toBe(false);
    expect(attrsProd.endsWith('; ')).toBe(false);
    expect(attrsDev.startsWith('; ')).toBe(false);
    expect(attrsDev.endsWith('; ')).toBe(false);

    // No empty entries from double separators.
    expect(attrsProd).not.toMatch(/;;/);
    expect(attrsDev).not.toMatch(/;;/);
  });

  it('exposes the expected attribute order (path, SameSite, Secure?)', () => {
    // Locking down the order keeps the produced cookie string reproducible
    // for snapshot-based debugging and for any future server-side parser.
    expect(buildCookieAttributes(false)).toBe('path=/; SameSite=Strict');
    expect(buildCookieAttributes(true)).toBe('path=/; SameSite=Strict; Secure');
  });
});
