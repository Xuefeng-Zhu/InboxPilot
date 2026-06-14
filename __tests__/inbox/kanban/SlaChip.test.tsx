/**
 * @vitest-environment jsdom
 */

import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SlaChip } from '../../../app/inbox/kanban/_components/SlaChip';
import { DEFAULT_SLA_THRESHOLDS } from '../../../app/inbox/kanban/_lib/constants';
import { slaTier } from '../../../app/inbox/kanban/_lib/sla';

const NOW = new Date('2026-06-14T12:00:00.000Z');

describe('SlaChip', () => {
  it('renders "new" for lastMessageAt === null', () => {
    const { container } = render(
      <SlaChip
        lastMessageAt={null}
        now={NOW}
        thresholds={DEFAULT_SLA_THRESHOLDS}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('new');
    // Tailwind class for the neutral gray tier
    expect(container.firstElementChild?.className).toContain('gray-100');
  });

  it('renders green tier for a 30s delta', () => {
    const lastMessageAt = new Date(NOW.getTime() - 30_000).toISOString();
    const { container } = render(
      <SlaChip
        lastMessageAt={lastMessageAt}
        now={NOW}
        thresholds={DEFAULT_SLA_THRESHOLDS}
      />,
    );
    expect(container.textContent).toContain('30s');
    expect(container.firstElementChild?.className).toContain('emerald-100');
  });

  it('renders amber tier for a 10min delta', () => {
    const lastMessageAt = new Date(NOW.getTime() - 600_000).toISOString();
    const { container } = render(
      <SlaChip
        lastMessageAt={lastMessageAt}
        now={NOW}
        thresholds={DEFAULT_SLA_THRESHOLDS}
      />,
    );
    expect(container.textContent).toContain('10m');
    expect(container.firstElementChild?.className).toContain('amber-100');
  });

  it('renders red tier for a 2h delta', () => {
    const lastMessageAt = new Date(NOW.getTime() - 7_200_000).toISOString();
    const { container } = render(
      <SlaChip
        lastMessageAt={lastMessageAt}
        now={NOW}
        thresholds={DEFAULT_SLA_THRESHOLDS}
      />,
    );
    expect(container.textContent).toContain('2h');
    expect(container.firstElementChild?.className).toContain('rose-100');
  });

  it('renders 30s label for 30s delta (sub-minute seconds format)', () => {
    const lastMessageAt = new Date(NOW.getTime() - 30_000).toISOString();
    const { container } = render(
      <SlaChip
        lastMessageAt={lastMessageAt}
        now={NOW}
        thresholds={DEFAULT_SLA_THRESHOLDS}
      />,
    );
    expect(container.textContent).toBe('30s');
  });

  it('renders 10m label for 10min delta (sub-hour minutes format)', () => {
    const lastMessageAt = new Date(NOW.getTime() - 600_000).toISOString();
    const { container } = render(
      <SlaChip
        lastMessageAt={lastMessageAt}
        now={NOW}
        thresholds={DEFAULT_SLA_THRESHOLDS}
      />,
    );
    expect(container.textContent).toBe('10m');
  });

  it('renders 1h22 label for 1h22m delta (hour+remainder format)', () => {
    const lastMessageAt = new Date(NOW.getTime() - (82 * 60_000)).toISOString();
    const { container } = render(
      <SlaChip
        lastMessageAt={lastMessageAt}
        now={NOW}
        thresholds={DEFAULT_SLA_THRESHOLDS}
      />,
    );
    expect(container.textContent).toBe('1h22');
  });

  it('renders 2d label for 2-day delta (day format)', () => {
    const lastMessageAt = new Date(NOW.getTime() - (2 * 86_400_000)).toISOString();
    const { container } = render(
      <SlaChip
        lastMessageAt={lastMessageAt}
        now={NOW}
        thresholds={DEFAULT_SLA_THRESHOLDS}
      />,
    );
    expect(container.textContent).toBe('2d');
  });
});
