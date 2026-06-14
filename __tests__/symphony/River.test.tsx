/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { River } from '../../app/symphony/_components/River';
import type { RiverCardData } from '../../app/symphony/_components/RiverCard';

vi.mock('@/lib/queries', async () => ({
  useMessages: () => ({ data: [] }),
  useAiDecision: () => ({ data: null }),
}));

vi.mock('@/lib/insforge', () => ({ getAccessToken: () => null }));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function makeCards(): RiverCardData[] {
  return [
    {
      id: 'a',
      contactName: 'Alice',
      contactInitial: 'A',
      channel: 'sms',
      lastMessageAt: new Date(Date.now() - 60_000).toISOString(),
      lastMessagePreview: 'Hello',
      aiState: 'idle',
      status: 'open',
    },
    {
      id: 'b',
      contactName: 'Bob',
      contactInitial: 'B',
      channel: 'email',
      lastMessageAt: new Date().toISOString(),
      lastMessagePreview: 'World',
      aiState: 'drafted',
      status: 'open',
    },
  ];
}

describe('River', () => {
  it('renders the empty state when there are no cards', () => {
    const { getByTestId } = renderWithClient(
      <River cards={[]} activeId={null} onSelect={() => {}} />,
    );
    expect(getByTestId('river-empty')).toBeTruthy();
  });

  it('renders a list with role="list" and an aria-label', () => {
    const { getByTestId } = renderWithClient(
      <River cards={makeCards()} activeId="a" onSelect={() => {}} />,
    );
    const list = getByTestId('river');
    expect(list.getAttribute('role')).toBe('list');
    expect(list.getAttribute('aria-label')).toBe('Conversation river');
  });

  it('renders a card for each conversation and fires onSelect on click', () => {
    const onSelect = vi.fn();
    const { getByTestId } = renderWithClient(
      <River cards={makeCards()} activeId="a" onSelect={onSelect} />,
    );
    fireEvent.click(getByTestId('river-card-b'));
    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('marks the active card with aria-current="true"', () => {
    const { getByTestId } = renderWithClient(
      <River cards={makeCards()} activeId="b" onSelect={() => {}} />,
    );
    const active = getByTestId('river-card-b');
    expect(active.getAttribute('aria-current')).toBe('true');
    const inactive = getByTestId('river-card-a');
    expect(inactive.getAttribute('aria-current')).toBeNull();
  });
});
