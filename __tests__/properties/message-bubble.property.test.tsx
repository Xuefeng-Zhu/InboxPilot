/**
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import React from 'react';
import { render } from '@testing-library/react';
import { MessageBubble, type MessageRow } from '../../components/inbox/MessageBubble';

/**
 * Property 8: Message bubble sender-type styling
 *
 * For any message with sender_type being either "contact" or "user"/"ai",
 * the rendered MessageBubble should apply distinct background colors —
 * gray/light background for customer messages, white background for agent/AI replies.
 *
 * Tag: Feature: stitch-ui-implementation, Property 8: Message bubble sender-type styling
 * Validates: Requirements 8.5
 */

// --- Arbitraries ---

const nonSystemSenderTypeArb = fc.constantFrom('contact', 'user', 'ai') as fc.Arbitrary<
  'contact' | 'user' | 'ai'
>;

const messageRowArb = (senderType: 'contact' | 'user' | 'ai'): fc.Arbitrary<MessageRow> =>
  fc.record({
    id: fc.uuid(),
    conversation_id: fc.uuid(),
    sender_type: fc.constant(senderType),
    sender_id: fc.option(fc.uuid(), { nil: null }),
    direction: fc.constantFrom('inbound', 'outbound') as fc.Arbitrary<'inbound' | 'outbound'>,
    channel: fc.constantFrom('sms', 'email') as fc.Arbitrary<'sms' | 'email'>,
    body: fc.string({ minLength: 1, maxLength: 200 }),
    subject: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
    raw_payload: fc.constant({}),
    provider: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: null }),
    provider_account_id: fc.option(fc.uuid(), { nil: null }),
    external_message_id: fc.option(fc.uuid(), { nil: null }),
    delivery_status: fc.constantFrom('sent', 'delivered', 'failed', 'pending'),
    created_at: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }).map((d) => d.toISOString()),
    updated_at: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }).map((d) => d.toISOString()),
  });

// --- Property tests ---

describe('Feature: stitch-ui-implementation, Property 8: Message bubble sender-type styling', () => {
  it('contact messages render with bg-white and border-surface-border classes', () => {
    fc.assert(
      fc.property(messageRowArb('contact'), (message) => {
        const { container } = render(<MessageBubble message={message} />);
        const bubble = container.querySelector('.rounded.border')!;
        expect(bubble).not.toBeNull();
        expect(bubble.className).toContain('bg-white');
        expect(bubble.className).toContain('border-surface-border');
      }),
      { numRuns: 100 },
    );
  });

  it('user messages render with bg-white and border-surface-border classes', () => {
    fc.assert(
      fc.property(
        messageRowArb('user'),
        (message) => {
          const { container } = render(<MessageBubble message={message} />);
          const bubble = container.querySelector('.rounded.border')!;
          expect(bubble).not.toBeNull();
          expect(bubble.className).toContain('bg-white');
          expect(bubble.className).toContain('border-surface-border');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('AI messages render with ai-tinted background and border classes', () => {
    fc.assert(
      fc.property(messageRowArb('ai'), (message) => {
        const { container } = render(<MessageBubble message={message} />);
        const bubble = container.querySelector('.rounded.border')!;
        expect(bubble).not.toBeNull();
        expect(bubble.className).toContain('bg-ai-50/50');
        expect(bubble.className).toContain('border-ai-200');
      }),
      { numRuns: 100 },
    );
  });

  it('renders the correct sender label text for any non-system sender type', () => {
    const labelMap: Record<string, string> = {
      contact: 'Customer',
      user: 'Agent',
      ai: 'AI',
    };

    fc.assert(
      fc.property(
        nonSystemSenderTypeArb.chain((st) =>
          messageRowArb(st).map((msg) => ({ msg, expectedLabel: labelMap[st] })),
        ),
        ({ msg, expectedLabel }) => {
          const { container } = render(<MessageBubble message={msg} />);
          const labelEl = container.querySelector('.text-body-sm.font-medium.text-gray-900');
          expect(labelEl).not.toBeNull();
          expect(labelEl!.textContent).toBe(expectedLabel);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('renders the message body text for any non-system message', () => {
    fc.assert(
      fc.property(
        nonSystemSenderTypeArb.chain((st) => messageRowArb(st)),
        (message) => {
          const { container } = render(<MessageBubble message={message} />);
          const bodyEl = container.querySelector('.whitespace-pre-wrap.text-body-md');
          expect(bodyEl).not.toBeNull();
          expect(bodyEl!.textContent).toBe(message.body);
        },
      ),
      { numRuns: 100 },
    );
  });
});
