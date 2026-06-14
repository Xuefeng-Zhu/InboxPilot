/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { MiniMap, type MiniMapBar } from '../../app/symphony/_components/MiniMap';

function makeBars(): MiniMapBar[] {
  return [
    { conversationId: 'a', leftPct: 10, tone: 'sent', isActive: false },
    { conversationId: 'b', leftPct: 30, tone: 'drafting', isActive: false },
    { conversationId: 'c', leftPct: 50, tone: 'escalated', isActive: true },
    { conversationId: 'd', leftPct: 70, tone: 'idle', isActive: false },
  ];
}

describe('MiniMap', () => {
  it('renders one button per bar', () => {
    const { container } = render(
      <MiniMap
        bars={makeBars()}
        windowStart={new Date('2026-06-07T00:00:00Z')}
        windowEnd={new Date('2026-06-14T00:00:00Z')}
        totalInWindow={4}
        autoRepliedCount={1}
        awaitingYouCount={1}
        onBarClick={() => {}}
      />,
    );
    const buttons = container.querySelectorAll('button[data-testid^="minimap-bar-"]');
    expect(buttons.length).toBe(4);
  });

  it('positions each bar by its leftPct', () => {
    const { getByTestId } = render(
      <MiniMap
        bars={makeBars()}
        windowStart={new Date('2026-06-07T00:00:00Z')}
        windowEnd={new Date('2026-06-14T00:00:00Z')}
        totalInWindow={4}
        autoRepliedCount={1}
        awaitingYouCount={1}
        onBarClick={() => {}}
      />,
    );
    const barA = getByTestId('minimap-bar-a') as HTMLElement;
    expect(barA.style.left).toBe('10%');
    const barC = getByTestId('minimap-bar-c') as HTMLElement;
    expect(barC.style.left).toBe('50%');
  });

  it('applies tone classes per bar (green, orange, red, gray)', () => {
    const { getByTestId } = render(
      <MiniMap
        bars={makeBars()}
        windowStart={new Date('2026-06-07T00:00:00Z')}
        windowEnd={new Date('2026-06-14T00:00:00Z')}
        totalInWindow={4}
        autoRepliedCount={1}
        awaitingYouCount={1}
        onBarClick={() => {}}
      />,
    );
    const a = getByTestId('minimap-bar-a');
    const b = getByTestId('minimap-bar-b');
    const c = getByTestId('minimap-bar-c');
    const d = getByTestId('minimap-bar-d');
    expect(a.className).toContain('m03-green');
    expect(b.className).toContain('m03-orange');
    expect(c.className).toContain('m03-red');
    expect(d.className).toContain('m03-line');
  });

  it('marks the active bar with a shadow ring', () => {
    const { getByTestId } = render(
      <MiniMap
        bars={makeBars()}
        windowStart={new Date('2026-06-07T00:00:00Z')}
        windowEnd={new Date('2026-06-14T00:00:00Z')}
        totalInWindow={4}
        autoRepliedCount={1}
        awaitingYouCount={1}
        onBarClick={() => {}}
      />,
    );
    const c = getByTestId('minimap-bar-c');
    expect(c.className).toContain('shadow-');
  });

  it('fires onBarClick with the conversation id when a bar is clicked', () => {
    const onBarClick = vi.fn();
    const { getByTestId } = render(
      <MiniMap
        bars={makeBars()}
        windowStart={new Date('2026-06-07T00:00:00Z')}
        windowEnd={new Date('2026-06-14T00:00:00Z')}
        totalInWindow={4}
        autoRepliedCount={1}
        awaitingYouCount={1}
        onBarClick={onBarClick}
      />,
    );
    fireEvent.click(getByTestId('minimap-bar-b'));
    expect(onBarClick).toHaveBeenCalledWith('b');
  });

  it('renders the conversation count in the labels row', () => {
    const { getByText } = render(
      <MiniMap
        bars={makeBars()}
        windowStart={new Date('2026-06-07T00:00:00Z')}
        windowEnd={new Date('2026-06-14T00:00:00Z')}
        totalInWindow={4}
        autoRepliedCount={2}
        awaitingYouCount={3}
        onBarClick={() => {}}
      />,
    );
    expect(getByText(/4 conversations/i)).toBeTruthy();
    expect(getByText(/2 auto-replied/i)).toBeTruthy();
    expect(getByText(/3 awaiting you/i)).toBeTruthy();
  });
});
