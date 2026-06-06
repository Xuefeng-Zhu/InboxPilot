import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { MockSmsAdapter } from '@support-core/adapters/mock-sms-adapter';
import { MockEmailAdapter } from '@support-core/adapters/mock-email-adapter';
import { TwilioSmsAdapter } from '@support-core/adapters/twilio-sms-adapter';
import { TelnyxSmsAdapter } from '@support-core/adapters/telnyx-sms-adapter';
import { PostmarkEmailAdapter } from '@support-core/adapters/postmark-email-adapter';

/**
 * Property-based tests for webhook payload normalization round-trip.
 *
 * Feature: ai-customer-support
 */

describe('Webhook payload normalization round-trip', () => {
  /**
   * Property 3 (SMS portion): Webhook payload normalization round-trip for mock SMS
   *
   * For any valid inbound SMS webhook payload (mock format), normalizing the
   * payload, serializing the normalized result to JSON, deserializing it, and
   * normalizing again SHALL produce an equivalent normalized payload.
   *
   * **Validates: Requirements 7.2, 29.1, 29.10**
   *
   * Feature: ai-customer-support, Property 3 (SMS portion): Webhook payload normalization round-trip for mock SMS
   */
  it('Property 3 (SMS portion): mock SMS webhook normalization is round-trip stable', () => {
    const adapter = new MockSmsAdapter();

    // Generator for E.164 phone numbers: +{1-3 digit country code}{6-12 digit subscriber}
    const e164Phone = fc
      .tuple(
        fc.integer({ min: 1, max: 999 }),
        fc.stringOf(
          fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'),
          { minLength: 6, maxLength: 12 }
        )
      )
      .filter(([cc, sub]) => {
        const totalDigits = cc.toString().length + sub.length;
        return totalDigits >= 7 && totalDigits <= 15;
      })
      .map(([cc, sub]) => `+${cc}${sub}`);

    // Generator for non-empty message body strings
    const messageBody = fc.string({ minLength: 1, maxLength: 500 });

    // Generator for message IDs (non-empty alphanumeric-like strings)
    const messageId = fc
      .stringOf(
        fc.constantFrom(
          ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'.split('')
        ),
        { minLength: 1, maxLength: 64 }
      );

    // Generator for valid mock SMS webhook payloads
    const mockSmsPayload = fc
      .tuple(e164Phone, e164Phone, messageBody, messageId)
      .map(([from, to, body, msgId]) => ({
        from,
        to,
        body,
        messageId: msgId,
      }));

    fc.assert(
      fc.property(mockSmsPayload, (payload) => {
        // Step 1: Parse the webhook payload into NormalizedInboundSms
        const normalized1 = adapter.parseInboundWebhook(payload);

        // Step 2: Serialize to JSON
        const serialized = JSON.stringify(normalized1);

        // Step 3: Deserialize from JSON
        const deserialized = JSON.parse(serialized);

        // Step 4: Wrap back into mock webhook format
        const wrappedBack = {
          from: deserialized.from,
          to: deserialized.to,
          body: deserialized.body,
          messageId: deserialized.externalMessageId,
        };

        // Step 5: Parse again with the adapter
        const normalized2 = adapter.parseInboundWebhook(wrappedBack);

        // Step 6: Assert equivalence (excluding rawPayload since it changes between passes)
        expect(normalized2.from).toBe(normalized1.from);
        expect(normalized2.to).toBe(normalized1.to);
        expect(normalized2.body).toBe(normalized1.body);
        expect(normalized2.externalMessageId).toBe(normalized1.externalMessageId);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 3 (email portion): Webhook payload normalization round-trip for mock email
   *
   * For any valid inbound email webhook payload (mock format), normalizing the
   * payload, serializing the normalized result to JSON, deserializing it, and
   * normalizing again SHALL produce an equivalent normalized payload.
   *
   * **Validates: Requirements 8.2, 29.2, 29.10**
   *
   * Feature: ai-customer-support, Property 3 (email portion): Webhook payload normalization round-trip for mock email
   */
  it('Property 3 (email portion): mock email webhook normalization is round-trip stable', () => {
    const adapter = new MockEmailAdapter();

    // Generator for email addresses
    const emailAddress = fc
      .tuple(
        fc.stringOf(
          fc.constantFrom(
            ...'abcdefghijklmnopqrstuvwxyz0123456789._-'.split('')
          ),
          { minLength: 1, maxLength: 20 }
        ),
        fc.stringOf(
          fc.constantFrom(
            ...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')
          ),
          { minLength: 1, maxLength: 15 }
        ),
        fc.constantFrom('com', 'org', 'net', 'io', 'co')
      )
      .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

    // Generator for non-empty subject strings
    const subject = fc.string({ minLength: 1, maxLength: 200 });

    // Generator for non-empty body text strings
    const bodyText = fc.string({ minLength: 1, maxLength: 500 });

    // Generator for optional body HTML strings
    const optionalBodyHtml = fc.option(
      fc.string({ minLength: 1, maxLength: 500 }),
      { nil: undefined }
    );

    // Generator for message IDs (non-empty alphanumeric-like strings)
    const messageId = fc.stringOf(
      fc.constantFrom(
        ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'.split('')
      ),
      { minLength: 1, maxLength: 64 }
    );

    // Generator for optional inReplyTo strings
    const optionalInReplyTo = fc.option(
      fc.stringOf(
        fc.constantFrom(
          ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-<>@.'.split('')
        ),
        { minLength: 1, maxLength: 64 }
      ),
      { nil: undefined }
    );

    // Generator for valid mock email webhook payloads
    const mockEmailPayload = fc
      .tuple(emailAddress, emailAddress, subject, bodyText, optionalBodyHtml, messageId, optionalInReplyTo)
      .map(([from, to, subj, body, html, msgId, replyTo]) => {
        const payload: Record<string, unknown> = {
          from,
          to,
          subject: subj,
          bodyText: body,
          messageId: msgId,
        };
        if (html !== undefined) {
          payload.bodyHtml = html;
        }
        if (replyTo !== undefined) {
          payload.inReplyTo = replyTo;
        }
        return payload;
      });

    fc.assert(
      fc.property(mockEmailPayload, (payload) => {
        // Step 1: Parse the webhook payload into NormalizedInboundEmail
        const normalized1 = adapter.parseInboundWebhook(payload);

        // Step 2: Serialize to JSON
        const serialized = JSON.stringify(normalized1);

        // Step 3: Deserialize from JSON
        const deserialized = JSON.parse(serialized);

        // Step 4: Wrap back into mock webhook format
        const wrappedBack: Record<string, unknown> = {
          from: deserialized.from,
          to: deserialized.to,
          subject: deserialized.subject,
          bodyText: deserialized.bodyText,
          messageId: deserialized.externalMessageId,
        };
        if (deserialized.bodyHtml !== undefined) {
          wrappedBack.bodyHtml = deserialized.bodyHtml;
        }
        if (deserialized.inReplyTo !== undefined) {
          wrappedBack.inReplyTo = deserialized.inReplyTo;
        }

        // Step 5: Parse again with the adapter
        const normalized2 = adapter.parseInboundWebhook(wrappedBack);

        // Step 6: Assert equivalence (excluding rawPayload since it changes between passes)
        expect(normalized2.from).toBe(normalized1.from);
        expect(normalized2.to).toBe(normalized1.to);
        expect(normalized2.subject).toBe(normalized1.subject);
        expect(normalized2.bodyText).toBe(normalized1.bodyText);
        expect(normalized2.bodyHtml).toBe(normalized1.bodyHtml);
        expect(normalized2.externalMessageId).toBe(normalized1.externalMessageId);
        expect(normalized2.inReplyTo).toBe(normalized1.inReplyTo);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 3 (Twilio SMS): Webhook payload normalization round-trip for Twilio SMS
   *
   * For any valid Twilio inbound SMS webhook payload, normalizing the payload,
   * serializing the normalized result to JSON, deserializing it, wrapping back
   * into Twilio format, and normalizing again SHALL produce an equivalent
   * normalized payload (excluding rawPayload).
   *
   * **Validates: Requirements 7.2, 29.1, 29.10**
   *
   * Feature: ai-customer-support, Property 3 (full SMS): Webhook payload normalization round-trip for Twilio
   */
  it('Property 3 (Twilio SMS): Twilio SMS webhook normalization is round-trip stable', () => {
    const adapter = new TwilioSmsAdapter();

    // Generator for E.164 phone numbers: +{1-3 digit country code}{6-12 digit subscriber}
    const e164Phone = fc
      .tuple(
        fc.integer({ min: 1, max: 999 }),
        fc.stringOf(
          fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'),
          { minLength: 6, maxLength: 12 }
        )
      )
      .filter(([cc, sub]) => {
        const totalDigits = cc.toString().length + sub.length;
        return totalDigits >= 7 && totalDigits <= 15;
      })
      .map(([cc, sub]) => `+${cc}${sub}`);

    // Generator for non-empty message body strings
    const messageBody = fc.string({ minLength: 1, maxLength: 500 });

    // Generator for Twilio MessageSid (non-empty alphanumeric-like strings prefixed with SM)
    const messageSid = fc
      .stringOf(
        fc.constantFrom(
          ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')
        ),
        { minLength: 10, maxLength: 34 }
      )
      .map((s) => `SM${s}`);

    // Generator for valid Twilio inbound SMS webhook payloads
    const twilioSmsPayload = fc
      .tuple(e164Phone, e164Phone, messageBody, messageSid)
      .map(([from, to, body, sid]) => ({
        From: from,
        To: to,
        Body: body,
        MessageSid: sid,
      }));

    fc.assert(
      fc.property(twilioSmsPayload, (payload) => {
        // Step 1: Parse the Twilio webhook payload into NormalizedInboundSms
        const normalized1 = adapter.parseInboundWebhook(payload);

        // Step 2: Serialize to JSON
        const serialized = JSON.stringify(normalized1);

        // Step 3: Deserialize from JSON
        const deserialized = JSON.parse(serialized);

        // Step 4: Wrap back into Twilio webhook format
        const wrappedBack = {
          From: deserialized.from,
          To: deserialized.to,
          Body: deserialized.body,
          MessageSid: deserialized.externalMessageId,
        };

        // Step 5: Parse again with the adapter
        const normalized2 = adapter.parseInboundWebhook(wrappedBack);

        // Step 6: Assert equivalence (excluding rawPayload since it changes between passes)
        expect(normalized2.from).toBe(normalized1.from);
        expect(normalized2.to).toBe(normalized1.to);
        expect(normalized2.body).toBe(normalized1.body);
        expect(normalized2.externalMessageId).toBe(normalized1.externalMessageId);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 3 (Telnyx SMS): Webhook payload normalization round-trip for Telnyx SMS
   *
   * For any valid Telnyx inbound SMS webhook payload, normalizing the payload,
   * serializing the normalized result to JSON, deserializing it, wrapping back
   * into Telnyx format, and normalizing again SHALL produce an equivalent
   * normalized payload (excluding rawPayload).
   *
   * **Validates: Requirements 7.2, 29.1, 29.10**
   *
   * Feature: ai-customer-support, Property 3 (full SMS): Webhook payload normalization round-trip for Telnyx
   */
  it('Property 3 (Telnyx SMS): Telnyx SMS webhook normalization is round-trip stable', () => {
    const adapter = new TelnyxSmsAdapter();

    // Generator for E.164 phone numbers: +{1-3 digit country code}{6-12 digit subscriber}
    const e164Phone = fc
      .tuple(
        fc.integer({ min: 1, max: 999 }),
        fc.stringOf(
          fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'),
          { minLength: 6, maxLength: 12 }
        )
      )
      .filter(([cc, sub]) => {
        const totalDigits = cc.toString().length + sub.length;
        return totalDigits >= 7 && totalDigits <= 15;
      })
      .map(([cc, sub]) => `+${cc}${sub}`);

    // Generator for non-empty message body strings
    const messageText = fc.string({ minLength: 1, maxLength: 500 });

    // Generator for Telnyx message IDs (UUID-like strings)
    const telnyxMessageId = fc
      .stringOf(
        fc.constantFrom(
          ...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')
        ),
        { minLength: 10, maxLength: 40 }
      );

    // Generator for valid Telnyx inbound SMS webhook payloads
    const telnyxSmsPayload = fc
      .tuple(e164Phone, e164Phone, messageText, telnyxMessageId)
      .map(([from, to, text, id]) => ({
        data: {
          event_type: 'message.received',
          payload: {
            from: { phone_number: from },
            to: [{ phone_number: to }],
            text,
            id,
          },
        },
      }));

    fc.assert(
      fc.property(telnyxSmsPayload, (payload) => {
        // Step 1: Parse the Telnyx webhook payload into NormalizedInboundSms
        const normalized1 = adapter.parseInboundWebhook(payload);

        // Step 2: Serialize to JSON
        const serialized = JSON.stringify(normalized1);

        // Step 3: Deserialize from JSON
        const deserialized = JSON.parse(serialized);

        // Step 4: Wrap back into Telnyx webhook format
        const wrappedBack = {
          data: {
            event_type: 'message.received',
            payload: {
              from: { phone_number: deserialized.from },
              to: [{ phone_number: deserialized.to }],
              text: deserialized.body,
              id: deserialized.externalMessageId,
            },
          },
        };

        // Step 5: Parse again with the adapter
        const normalized2 = adapter.parseInboundWebhook(wrappedBack);

        // Step 6: Assert equivalence (excluding rawPayload since it changes between passes)
        expect(normalized2.from).toBe(normalized1.from);
        expect(normalized2.to).toBe(normalized1.to);
        expect(normalized2.body).toBe(normalized1.body);
        expect(normalized2.externalMessageId).toBe(normalized1.externalMessageId);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 3 (Postmark email): Webhook payload normalization round-trip for Postmark email
   *
   * For any valid Postmark inbound email webhook payload, normalizing the payload,
   * serializing the normalized result to JSON, deserializing it, wrapping back
   * into Postmark format, and normalizing again SHALL produce an equivalent
   * normalized payload (excluding rawPayload).
   *
   * **Validates: Requirements 8.2, 29.2, 29.10**
   *
   * Feature: ai-customer-support, Property 3 (full email): Webhook payload normalization round-trip for Postmark
   */
  it('Property 3 (Postmark email): Postmark email webhook normalization is round-trip stable', () => {
    const adapter = new PostmarkEmailAdapter();

    // Generator for email addresses
    const emailAddress = fc
      .tuple(
        fc.stringOf(
          fc.constantFrom(
            ...'abcdefghijklmnopqrstuvwxyz0123456789._-'.split('')
          ),
          { minLength: 1, maxLength: 20 }
        ),
        fc.stringOf(
          fc.constantFrom(
            ...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')
          ),
          { minLength: 1, maxLength: 15 }
        ),
        fc.constantFrom('com', 'org', 'net', 'io', 'co')
      )
      .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

    // Generator for non-empty subject strings
    const subject = fc.string({ minLength: 1, maxLength: 200 });

    // Generator for non-empty body text strings
    const bodyText = fc.string({ minLength: 1, maxLength: 500 });

    // Generator for optional body HTML strings (non-empty when present)
    const optionalBodyHtml = fc.option(
      fc.string({ minLength: 1, maxLength: 500 }),
      { nil: undefined }
    );

    // Generator for Postmark MessageID (non-empty alphanumeric-like strings)
    const messageId = fc.stringOf(
      fc.constantFrom(
        ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'.split('')
      ),
      { minLength: 1, maxLength: 64 }
    );

    // Generator for optional InReplyTo strings (non-empty when present)
    const optionalInReplyTo = fc.option(
      fc.stringOf(
        fc.constantFrom(
          ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-<>@.'.split('')
        ),
        { minLength: 1, maxLength: 64 }
      ),
      { nil: undefined }
    );

    // Generator for valid Postmark inbound email webhook payloads
    const postmarkEmailPayload = fc
      .tuple(emailAddress, emailAddress, subject, bodyText, optionalBodyHtml, messageId, optionalInReplyTo)
      .map(([from, to, subj, body, html, msgId, replyTo]) => {
        const payload: Record<string, unknown> = {
          From: from,
          To: to,
          Subject: subj,
          TextBody: body,
          MessageID: msgId,
        };
        if (html !== undefined) {
          payload.HtmlBody = html;
        }
        if (replyTo !== undefined) {
          payload.InReplyTo = replyTo;
        }
        return payload;
      });

    fc.assert(
      fc.property(postmarkEmailPayload, (payload) => {
        // Step 1: Parse the Postmark webhook payload into NormalizedInboundEmail
        const normalized1 = adapter.parseInboundWebhook(payload);

        // Step 2: Serialize to JSON
        const serialized = JSON.stringify(normalized1);

        // Step 3: Deserialize from JSON
        const deserialized = JSON.parse(serialized);

        // Step 4: Wrap back into Postmark webhook format
        const wrappedBack: Record<string, unknown> = {
          From: deserialized.from,
          To: deserialized.to,
          Subject: deserialized.subject,
          TextBody: deserialized.bodyText,
          MessageID: deserialized.externalMessageId,
        };
        if (deserialized.bodyHtml !== undefined) {
          wrappedBack.HtmlBody = deserialized.bodyHtml;
        }
        if (deserialized.inReplyTo !== undefined) {
          wrappedBack.InReplyTo = deserialized.inReplyTo;
        }

        // Step 5: Parse again with the adapter
        const normalized2 = adapter.parseInboundWebhook(wrappedBack);

        // Step 6: Assert equivalence (excluding rawPayload since it changes between passes)
        expect(normalized2.from).toBe(normalized1.from);
        expect(normalized2.to).toBe(normalized1.to);
        expect(normalized2.subject).toBe(normalized1.subject);
        expect(normalized2.bodyText).toBe(normalized1.bodyText);
        expect(normalized2.bodyHtml).toBe(normalized1.bodyHtml);
        expect(normalized2.externalMessageId).toBe(normalized1.externalMessageId);
        expect(normalized2.inReplyTo).toBe(normalized1.inReplyTo);
      }),
      { numRuns: 100 }
    );
  });
});
