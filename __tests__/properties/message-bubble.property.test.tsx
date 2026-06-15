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
 * the rendered MessageBubble should apply distinct visual treatment matching
 * the M03 chat-bubble layout: customer (inbound) uses line-2 gray background,
 * agent (outbound) uses solid black background, AI uses an unstyled bubble
 * (draft/auto-reply/pending state is rendered by the AiDraftPanel, not per
 * message).
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
  it('contact messages render with line-2 background, left-aligned', () => {
    fc.assert(
      fc.property(messageRowArb('contact'), (message) => {
        const { container } = render(<MessageBubble message={message} />);
        const bubble = container.querySelector('.rounded-lg')!;
        expect(bubble).not.toBeNull();
        expect(bubble.className).toContain('bg-[var(--m03-line-2)]');
        const row = container.querySelector('.justify-start')!;
        expect(row).not.toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it('user messages render with black background, right-aligned', () => {
    fc.assert(
      fc.property(
        messageRowArb('user'),
        (message) => {
          const { container } = render(<MessageBubble message={message} />);
          const bubble = container.querySelector('.rounded-lg')!;
          expect(bubble).not.toBeNull();
          expect(bubble.className).toContain('bg-[var(--m03-fg)]');
          const row = container.querySelector('.justify-end')!;
          expect(row).not.toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('AI messages render left-aligned with an unstyled bubble (no state badge)', () => {
    fc.assert(
      fc.property(messageRowArb('ai'), (message) => {
        const { container } = render(<MessageBubble message={message} />);
        const bubble = container.querySelector('.rounded-lg')!;
        expect(bubble).not.toBeNull();
        // AI messages are not decorated per-message: draft/auto-reply state is
        // surfaced by the AiDraftPanel, not the bubble. The bubble should not
        // carry a colored background or border, and no state pill should exist.
        expect(bubble.className).not.toContain('bg-white');
        expect(bubble.className).not.toContain('bg-[var(--m03-line-2)]');
        expect(bubble.className).not.toContain('bg-[var(--m03-fg)]');
        expect(bubble.className).not.toContain('border-[var(--m03-orange)]');
        expect(bubble.className).not.toContain('border-[var(--m03-green)]');
        expect(bubble.className).not.toContain('border-[var(--m03-red)]');
        const row = container.querySelector('.justify-start')!;
        expect(row).not.toBeNull();
        // No AI-state pill should be rendered.
        expect(container.querySelector('[aria-label="DRAFTED"]')).toBeNull();
        expect(container.querySelector('[aria-label="AUTO-REPLIED"]')).toBeNull();
        expect(container.querySelector('[aria-label="THINKING"]')).toBeNull();
        expect(container.querySelector('[aria-label="NEEDS HUMAN"]')).toBeNull();
        expect(container.querySelector('[aria-label="FAILED"]')).toBeNull();
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
          // The sender name appears somewhere in the rendered text content.
          expect(container.textContent ?? '').toContain(expectedLabel);
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
          const bubble = container.querySelector('.rounded-lg')!;
          expect(bubble).not.toBeNull();
          expect(bubble!.textContent).toBe(message.body);
        },
      ),
      { numRuns: 100 },
    );
  });
});
