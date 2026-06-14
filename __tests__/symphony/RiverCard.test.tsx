/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RiverCard, type RiverCardData } from '../../app/symphony/_components/RiverCard';

// Mock the data hooks used inside RiverExpandedPanel so the active card
// (which renders the expanded panel) doesn't hit the network.
vi.mock('@/lib/queries', async () => {
  return {
    useMessages: () => ({ data: [] }),
    useAiDecision: () => ({ data: null }),
  };
});

vi.mock('@/lib/insforge', () => ({
  getAccessToken: () => null,
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function baseCard(overrides: Partial<RiverCardData> = {}): RiverCardData {
  return {
    id: 'c-1',
    contactName: 'Maya Chen',
    contactInitial: 'M',
    channel: 'sms',
    lastMessageAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    lastMessagePreview: "I haven't received my refund yet — it's been 5 business days.",
    aiState: 'idle',
    status: 'open',
    ...overrides,
  };
}

describe('RiverCard', () => {
  it('renders the contact name, channel label, and time', () => {
    const { getByText } = renderWithClient(
      <RiverCard data={baseCard()} isActive={false} onSelect={() => {}} />,
    );
    expect(getByText('Maya Chen')).toBeTruthy();
    expect(getByText(/sms/)).toBeTruthy();
  });

  it('renders a 3-line clamped preview when collapsed', () => {
    const { container } = renderWithClient(
      <RiverCard data={baseCard()} isActive={false} onSelect={() => {}} />,
    );
    const preview = container.querySelector('p.line-clamp-3');
    expect(preview).toBeTruthy();
  });

  it('applies green tone for the sent · auto pill', () => {
    const { container } = renderWithClient(
      <RiverCard
        data={baseCard({ aiState: 'auto_replied' })}
        isActive={false}
        onSelect={() => {}}
      />,
    );
    const pill = container.querySelector('[class*="m03-green"]');
    expect(pill).toBeTruthy();
    expect(pill?.textContent).toContain('sent');
  });

  it('applies red tone for the escalated pill when status=escalated', () => {
    const { container } = renderWithClient(
      <RiverCard
        data={baseCard({ status: 'escalated', aiState: 'needs_human' })}
        isActive={false}
        onSelect={() => {}}
      />,
    );
    const pill = container.querySelector('[class*="m03-red"]');
    expect(pill).toBeTruthy();
    expect(pill?.textContent).toContain('escalated');
  });

  it('renders the streaming placeholder text when isStreaming=true', () => {
    const { getByText } = renderWithClient(
      <RiverCard
        data={baseCard({ isStreaming: true })}
        isActive={false}
        onSelect={() => {}}
      />,
    );
    expect(getByText(/streaming in/i)).toBeTruthy();
  });

  it('renders the scheduled placeholder text when isScheduled=true', () => {
    const { getByText } = renderWithClient(
      <RiverCard
        data={baseCard({ isScheduled: true, scheduledLabel: '+2h' })}
        isActive={false}
        onSelect={() => {}}
      />,
    );
    expect(getByText(/scheduled follow-up/i)).toBeTruthy();
  });

  it('fires onSelect when the card is clicked', () => {
    const onSelect = vi.fn();
    const { getByTestId } = renderWithClient(
      <RiverCard data={baseCard()} isActive={false} onSelect={onSelect} />,
    );
    fireEvent.click(getByTestId('river-card-c-1'));
    expect(onSelect).toHaveBeenCalledWith('c-1');
  });

  it('marks the active card with aria-current=true and exposes the expanded panel', () => {
    const { getByTestId, container } = renderWithClient(
      <RiverCard data={baseCard()} isActive={true} onSelect={() => {}} />,
    );
    const card = getByTestId('river-card-c-1');
    expect(card.getAttribute('aria-current')).toBe('true');
    // The expanded panel is rendered (useMessages returns [], so no bubbles,
    // but the testid slot is reserved by the wrapper).
    expect(container.querySelector('[data-testid^="river-expanded-"]')).toBeTruthy();
  });
});
