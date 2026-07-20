/**
 * @vitest-environment jsdom
 */

import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { KanbanRow } from '../../../app/inbox/kanban/_components/KanbanRow';
import { DEFAULT_SLA_THRESHOLDS } from '../../../app/inbox/kanban/_lib/constants';
import type { ConversationListItem } from '../../../lib/queries/keys';

const NOW = new Date('2026-06-14T12:00:00.000Z');

function makeConversation(
  overrides: Partial<ConversationListItem> = {},
): ConversationListItem {
  return {
    id: 'conv-1',
    organization_id: 'org-1',
    contact_id: 'contact-1',
    channel: 'sms',
    status: 'open',
    ai_state: 'idle',
    subject: null,
    assigned_to: null,
    last_message_at: new Date(NOW.getTime() - 300_000).toISOString(),
    last_message_direction: 'inbound',
    created_at: NOW.toISOString(),
    contacts: null,
    ...overrides,
  };
}

describe('KanbanRow', () => {
  it('renders the contact display name', () => {
    const { container } = render(
      <KanbanRow
        conversation={makeConversation({
          contacts: {
            id: 'c1',
            organization_id: 'o1',
            name: 'Maya Patel',
            email: null,
            phone: null,
            metadata: {},
            created_at: NOW.toISOString(),
            updated_at: NOW.toISOString(),
          },
        })}
        isSelected={false}
        onClick={() => {}}
        thresholds={DEFAULT_SLA_THRESHOLDS}
        now={NOW}
      />,
    );
    expect(container.textContent).toContain('Maya Patel');
  });

  it('renders the SlaChip for the given lastMessageAt', () => {
    const { container } = render(
      <KanbanRow
        conversation={makeConversation()}
        isSelected={false}
        onClick={() => {}}
        thresholds={DEFAULT_SLA_THRESHOLDS}
        now={NOW}
      />,
    );
    // SlaChip renders an inline span; its label "5m" should be present
    expect(container.textContent).toContain('5m');
  });

  it('renders SMS channel pill for channel="sms"', () => {
    const { container } = render(
      <KanbanRow
        conversation={makeConversation({ channel: 'sms' })}
        isSelected={false}
        onClick={() => {}}
        thresholds={DEFAULT_SLA_THRESHOLDS}
        now={NOW}
      />,
    );
    expect(container.textContent).toContain('SMS');
  });

  it('renders EMAIL channel pill for channel="email"', () => {
    const { container } = render(
      <KanbanRow
        conversation={makeConversation({ channel: 'email' })}
        isSelected={false}
        onClick={() => {}}
        thresholds={DEFAULT_SLA_THRESHOLDS}
        now={NOW}
      />,
    );
    expect(container.textContent).toContain('EMAIL');
  });

  it('renders WEB channel pill for channel="webchat"', () => {
    const { container } = render(
      <KanbanRow
        conversation={makeConversation({ channel: 'webchat' })}
        isSelected={false}
        onClick={() => {}}
        thresholds={DEFAULT_SLA_THRESHOLDS}
        now={NOW}
      />,
    );
    expect(container.textContent).toContain('WEB');
  });

  it('renders the Review button when showReviewButton=true', () => {
    const { getByRole } = render(
      <KanbanRow
        conversation={makeConversation()}
        isSelected={false}
        onClick={() => {}}
        thresholds={DEFAULT_SLA_THRESHOLDS}
        now={NOW}
        showReviewButton
      />,
    );
    expect(getByRole('button', { name: 'Review' })).toBeInTheDocument();
  });

  it('opens the review workflow without also opening the details drawer', () => {
    const onClick = vi.fn();
    const onReview = vi.fn();
    const { getByRole } = render(
      <KanbanRow
        conversation={makeConversation({ ai_state: 'drafted' })}
        isSelected={false}
        onClick={onClick}
        onReview={onReview}
        thresholds={DEFAULT_SLA_THRESHOLDS}
        now={NOW}
        showReviewButton
      />,
    );

    fireEvent.click(getByRole('button', { name: 'Review' }));

    expect(onReview).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
  });
});
