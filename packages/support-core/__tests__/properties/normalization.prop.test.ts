import { describe, it } from 'vitest';
import fc from 'fast-check';
import { normalizePhone, normalizeEmail } from '@support-core/utils/normalization';

/**
 * Property-based tests for phone number and email normalization.
 *
 * Feature: ai-customer-support
 */

describe('Normalization property tests', () => {
  /**
   * Property 1: Phone number normalization round-trip
   *
   * For any valid phone number string in any common format, normalizing it to
   * E.164 and then normalizing the E.164 result again SHALL produce the same
   * E.164 string (idempotence).
   *
   * **Validates: Requirements 4.1**
   *
   * Feature: ai-customer-support, Property 1: Phone number normalization round-trip
   */
  it('Property 1: normalizePhone is idempotent for valid phone numbers', () => {
    // Generate US 10-digit phone numbers in various common formats
    const usPhoneArbitrary = fc
      .tuple(
        fc.integer({ min: 200, max: 999 }), // area code (2xx-9xx)
        fc.integer({ min: 200, max: 999 }), // exchange
        fc.integer({ min: 0, max: 9999 })   // subscriber
      )
      .chain(([area, exchange, subscriber]) => {
        const subscriberStr = subscriber.toString().padStart(4, '0');
        const digits = `${area}${exchange}${subscriberStr}`;

        // Pick a random format for the same digits
        return fc.constantFrom(
          digits,                                              // 2125551234
          `1${digits}`,                                        // 12125551234
          `+1${digits}`,                                       // +12125551234
          `(${area}) ${exchange}-${subscriberStr}`,            // (212) 555-1234
          `${area}-${exchange}-${subscriberStr}`,              // 212-555-1234
          `${area}.${exchange}.${subscriberStr}`,              // 212.555.1234
          `${area} ${exchange} ${subscriberStr}`,              // 212 555 1234
          `+1 (${area}) ${exchange}-${subscriberStr}`,         // +1 (212) 555-1234
          `+1-${area}-${exchange}-${subscriberStr}`,           // +1-212-555-1234
          `  +1${digits}  `,                                   // whitespace padded
        );
      });

    // International numbers with country code (2-3 digit code + 6-12 digit subscriber)
    const internationalPhoneArbitrary = fc
      .tuple(
        fc.integer({ min: 1, max: 999 }),    // country code
        fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), {
          minLength: 6,
          maxLength: 11,
        })
      )
      .filter(([cc, sub]) => {
        // Ensure total digits (country code + subscriber) is between 2 and 15 (E.164)
        const totalDigits = cc.toString().length + sub.length;
        return totalDigits >= 2 && totalDigits <= 15;
      })
      .map(([cc, sub]) => `+${cc}${sub}`);

    const validPhoneArbitrary = fc.oneof(usPhoneArbitrary, internationalPhoneArbitrary);

    fc.assert(
      fc.property(validPhoneArbitrary, (phone) => {
        const first = normalizePhone(phone);
        const second = normalizePhone(first);
        return second === first;
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2: Email normalization idempotence
   *
   * For any valid email address string with arbitrary casing and
   * leading/trailing whitespace, normalizing it and then normalizing the
   * result again SHALL produce the same normalized string.
   *
   * **Validates: Requirements 4.2**
   *
   * Feature: ai-customer-support, Property 2: Email normalization idempotence
   */
  it('Property 2: normalizeEmail is idempotent for valid email addresses', () => {
    // Generate valid local parts: alphanumeric + dots/hyphens/underscores
    const localPartChar = fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-+'.split('')
    );
    const localPartArbitrary = fc
      .stringOf(localPartChar, { minLength: 1, maxLength: 30 })
      // Ensure local part doesn't start/end with a dot (common email rule)
      .filter((s) => !s.startsWith('.') && !s.endsWith('.'));

    // Generate valid domain labels: alphanumeric + hyphens
    const domainLabelChar = fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')
    );
    const domainLabelArbitrary = fc.stringOf(domainLabelChar, { minLength: 1, maxLength: 15 });

    // TLD: 2-6 alpha characters
    const tldArbitrary = fc.stringOf(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')),
      { minLength: 2, maxLength: 6 }
    );

    // Full domain: label.tld (guaranteed to have at least one dot)
    const domainArbitrary = fc
      .tuple(domainLabelArbitrary, tldArbitrary)
      .map(([label, tld]) => `${label}.${tld}`);

    // Apply random casing via mixedCase and optional leading/trailing whitespace
    const validEmailArbitrary = fc
      .tuple(
        localPartArbitrary,
        domainArbitrary,
        fc.stringOf(fc.constantFrom(' ', '\t'), { minLength: 0, maxLength: 5 }), // leading ws
        fc.stringOf(fc.constantFrom(' ', '\t'), { minLength: 0, maxLength: 5 })  // trailing ws
      )
      .map(([local, domain, leadingWs, trailingWs]) => {
        return `${leadingWs}${local}@${domain}${trailingWs}`;
      });

    fc.assert(
      fc.property(validEmailArbitrary, (email) => {
        const first = normalizeEmail(email);
        const second = normalizeEmail(first);
        return second === first;
      }),
      { numRuns: 100 }
    );
  });
});
