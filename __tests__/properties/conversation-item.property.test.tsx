/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import React from 'react';
import { render } from '@testing-library/react';
import { ConversationItem, ConversationRow } from '../../components/inbox/ConversationItem';

/**
 * Property 7: Conversation item information completeness
 *
 * For any valid conversation object (with subject, timestamp, channel, status,
 * and read/selected state), the rendered ConversationItem should display:
 * a message preview (or subject), a relative timestamp, a channel indicator,
 * and a status badge. When unread, it should additionally show a 6px indigo dot
 * and bold text. When selected, it should show the active indicator styling.
 *
 * Tag: Feature: stitch-ui-implementation, Property 7: Conversation item information completeness
 * Validates: Requirements 8.2, 8.3, 8.4
 */

// --- Mock next/link to avoid router dependency ---
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) =>
    React.createElement('a', { href, ...props }, children),
}));

// --- Arbitraries ---

const channelArb = fc.constantFrom('sms', 'email', 'webchat') as fc.Arbitrary<
  'sms' | 'email' | 'webchat'
>;

const statusArb = fc.constantFrom('open', 'pending', 'escalated', 'resolved') as fc.Arbitrary<
  'open' | 'pending' | 'escalated' | 'resolved'
>;

const aiStateArb = fc.constantFrom(
  'idle',
  'thinking',
  'drafted',
  'auto_replied',
  'needs_human',
  'failed',
) as fc.Arbitrary<'idle' | 'thinking' | 'drafted' | 'auto_replied' | 'needs_human' | 'failed'>;

const conversationArb = fc.record({
  id: fc.uuid(),
  organization_id: fc.uuid(),
  contact_id: fc.uuid(),
  channel: channelArb,
  status: statusArb,
  ai_state: aiStateArb,
  subject: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
  assigned_to: fc.constant(null),
  last_message_at: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }).map((d) =>
    d.toISOString(),
  ),
  metadata: fc.constant({}),
  created_at: fc.constant(new Date().toISOString()),
  updated_at: fc.constant(new Date().toISOString()),
  contacts: fc.record({
    id: fc.uuid(),
    organization_id: fc.uuid(),
    name: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: null }),
    email: fc.constant('test@example.com'),
    phone: fc.constant('+15551234567'),
    metadata: fc.constant({}),
    created_at: fc.constant(new Date().toISOString()),
    updated_at: fc.constant(new Date().toISOString()),
  }),
  latest_message: fc.option(
    fc.record({
      conversation_id: fc.uuid(),
      body: fc.string({ minLength: 1, maxLength: 160 }),
      subject: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
      created_at: fc.constant(new Date().toISOString()),
    }),
    { nil: null },
  ),
}) as fc.Arbitrary<ConversationRow>;

const isUnreadArb = fc.boolean();
const isSelectedArb = fc.boolean();

// --- Property Tests ---

describe('Feature: stitch-ui-implementation, Property 7: Conversation item information completeness', () => {
  it('renders a timestamp for any valid conversation', () => {
    fc.assert(
      fc.property(conversationArb, isUnreadArb, isSelectedArb, (conversation, isUnread, isSelected) => {
        const onSelect = vi.fn();
        const { container } = render(
          <ConversationItem
            conversation={conversation}
            isSelected={isSelected}
            isUnread={isUnread}
            onSelect={onSelect}
          />,
        );

        // The timestamp should be rendered as text content (e.g., "2m ago", "3d ago", etc.)
        const textContent = container.textContent ?? '';
        // Timestamp patterns: "Just now", "Xm ago", "Xh ago", "Xd ago", or a date like "Jan 5"
        const hasTimestamp =
          /Just now|\d+m ago|\d+h ago|\d+d ago|[A-Z][a-z]{2} \d+/.test(textContent);
        expect(hasTimestamp).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('renders a channel indicator for any valid conversation', () => {
    fc.assert(
      fc.property(conversationArb, isUnreadArb, isSelectedArb, (conversation, isUnread, isSelected) => {
        const onSelect = vi.fn();
        const { container } = render(
          <ConversationItem
            conversation={conversation}
            isSelected={isSelected}
            isUnread={isUnread}
            onSelect={onSelect}
          />,
        );

        const textContent = container.textContent ?? '';
        const hasChannelIndicator =
          textContent.includes('Email') || textContent.includes('SMS') || textContent.includes('Web');
        expect(hasChannelIndicator).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('renders useful anonymous webchat fallbacks with a stable visitor id and preview', () => {
    const conversation: ConversationRow = {
      id: '11111111-1111-4111-8111-111111111111',
      organization_id: '22222222-2222-4222-8222-222222222222',
      contact_id: '33333333-3333-4333-8333-333333333333',
      channel: 'webchat',
      status: 'open',
      ai_state: 'auto_replied',
      subject: null,
      assigned_to: null,
      last_message_at: null,
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      contacts: {
        id: '44444444-4444-4444-8444-444444444444',
        organization_id: '22222222-2222-4222-8222-222222222222',
        name: null,
        email: null,
        phone: null,
        metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      latest_message: {
        conversation_id: '11111111-1111-4111-8111-111111111111',
        body: 'order status',
        subject: null,
        created_at: new Date().toISOString(),
      },
    };

    const { getByText, queryByText } = render(
      <ConversationItem
        conversation={conversation}
        isSelected={false}
        onSelect={vi.fn()}
      />,
    );

    expect(getByText('Visitor #44444444')).toBeTruthy();
    expect(getByText('Just now')).toBeTruthy();
    expect(getByText('Web chat conversation')).toBeTruthy();
    expect(getByText('order status')).toBeTruthy();
    expect(queryByText('No subject')).toBeNull();
    expect(queryByText('No preview available')).toBeNull();
  });

  it('renders a status badge for any valid conversation', () => {
    fc.assert(
      fc.property(conversationArb, isUnreadArb, isSelectedArb, (conversation, isUnread, isSelected) => {
        const onSelect = vi.fn();
        const { container } = render(
          <ConversationItem
            conversation={conversation}
            isSelected={isSelected}
            isUnread={isUnread}
            onSelect={onSelect}
          />,
        );

        // The StatusBadge renders with rounded-full class
        const badges = container.querySelectorAll('.rounded-full');
        // At least one badge should have status text content
        const statusTexts = ['Open', 'Pending', 'Escalated', 'Resolved'];
        const textContent = container.textContent ?? '';
        const hasStatusBadge = statusTexts.some((s) => textContent.includes(s));
        expect(hasStatusBadge).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('shows unread dot (bg-primary) and bold text (font-semibold) when isUnread=true', () => {
    fc.assert(
      fc.property(conversationArb, isSelectedArb, (conversation, isSelected) => {
        const onSelect = vi.fn();
        const { container } = render(
          <ConversationItem
            conversation={conversation}
            isSelected={isSelected}
            isUnread={true}
            onSelect={onSelect}
          />,
        );

        // Check for unread dot: element with bg-primary class
        const dotElement = container.querySelector('.bg-primary');
        expect(dotElement).not.toBeNull();

        // Check for bold text: element with font-semibold class
        const boldElement = container.querySelector('.font-semibold');
        expect(boldElement).not.toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it('shows active indicator styling (bg-surface-container and border-l-primary) when isSelected=true', () => {
    fc.assert(
      fc.property(conversationArb, isUnreadArb, (conversation, isUnread) => {
        const onSelect = vi.fn();
        const { container } = render(
          <ConversationItem
            conversation={conversation}
            isSelected={true}
            isUnread={isUnread}
            onSelect={onSelect}
          />,
        );

        // The container button should have bg-surface-container and border-l-primary classes
        const button = container.querySelector('button');
        expect(button).not.toBeNull();
        const className = button!.className;
        expect(className).toContain('bg-surface-container');
        expect(className).toContain('border-l-primary');
      }),
      { numRuns: 100 },
    );
  });
});
