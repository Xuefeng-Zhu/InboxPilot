/**
 * @vitest-environment jsdom
 */
import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { InboxFilters, type InboxFilterState } from '../../components/inbox/InboxFilters';

// CustomerSelector inside the expanded panel pulls in React Query + auth context,
// which are out of scope for these collapse-behavior tests. The selector is
// incidental — the search input, channel pills, status pills, and toggle are all
// owned by InboxFilters itself. Stub the selector to a no-op render.
vi.mock('../../components/inbox/CustomerSelector', () => ({
  CustomerSelector: () => null,
}));

function makeHarness() {
  const initial: InboxFilterState = { status: 'all', channel: 'all', search: '', customerId: null };
  const calls: { onChange: InboxFilterState[] } = { onChange: [] };
  function Harness({ counts }: { counts?: { total: number; escalated: number; drafted: number } }) {
    const [filters, setFilters] = useState<InboxFilterState>(initial);
    return (
      <InboxFilters
        filters={filters}
        counts={counts}
        onChange={(f) => { calls.onChange.push(f); setFilters(f); }}
        onSearchCommit={() => {}}
        onClearAll={() => {}}
      />
    );
  }
  return { Harness, calls };
}

describe('InboxFilters (collapse behavior)', () => {
  it('renders in collapsed state by default (no search input visible)', () => {
    const { Harness } = makeHarness();
    render(<Harness />);
    expect(screen.queryByPlaceholderText(/search conversations/i)).toBeNull();
  });

  it('toggle button has aria-expanded="false" and aria-label "Show filters" when collapsed', () => {
    const { Harness } = makeHarness();
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: /show filters/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe('inbox-filters-panel');
  });

  it('clicking the toggle expands the panel and shows the search input', () => {
    const { Harness } = makeHarness();
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: /show filters/i });
    fireEvent.click(toggle);
    expect(screen.getByPlaceholderText(/search conversations/i)).toBeInTheDocument();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toMatch(/hide filters/i);
    expect(document.getElementById('inbox-filters-panel')).toBeInTheDocument();
  });

  it('clicking the toggle a second time collapses the panel and hides the search input', () => {
    const { Harness } = makeHarness();
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: /show filters/i });
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(screen.queryByPlaceholderText(/search conversations/i)).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toMatch(/show filters/i);
    expect(document.getElementById('inbox-filters-panel')).toBeNull();
  });

  it('status pills are always visible in both states', () => {
    const { Harness } = makeHarness();
    render(<Harness />);
    expect(screen.getByRole('button', { name: /^all$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^open$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^escalated$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^resolved$/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /show filters/i }));
    // After expansion, both the status "All" pill and the channel "All" pill match /^all$/i.
    // Asserting "still findable" rather than "exactly one" preserves the test's intent.
    expect(screen.getAllByRole('button', { name: /^all$/i }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: /^resolved$/i })).toBeInTheDocument();
  });

  it('header title "Inbox" is always visible in both states', () => {
    const { Harness } = makeHarness();
    render(<Harness />);
    expect(screen.getByRole('heading', { level: 1, name: /inbox/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /show filters/i }));
    expect(screen.getByRole('heading', { level: 1, name: /inbox/i })).toBeInTheDocument();
  });

  it('subline counts are always visible in both states when counts prop is provided', () => {
    const { Harness } = makeHarness();
    render(<Harness counts={{ total: 12, escalated: 3, drafted: 5 }} />);
    expect(screen.getByText(/12 conversations · 3 escalated · 5 AI drafted/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /show filters/i }));
    expect(screen.getByText(/12 conversations · 3 escalated · 5 AI drafted/i)).toBeInTheDocument();
  });

  it('clicking a status pill in collapsed state still fires onChange', () => {
    const { Harness, calls } = makeHarness();
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /^escalated$/i }));
    expect(calls.onChange).toHaveLength(1);
    expect(calls.onChange[0]?.status).toBe('escalated');
  });
});
