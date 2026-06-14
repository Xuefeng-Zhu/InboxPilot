/**
 * @vitest-environment jsdom
 */

import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { KanbanLane } from '../../../app/inbox/kanban/_components/KanbanLane';
import { KanbanEmptyState } from '../../../app/inbox/kanban/_components/KanbanEmptyState';

describe('KanbanLane', () => {
  it('renders the title and count in the header', () => {
    const { getByText, container } = render(
      <KanbanLane laneId="mine" title="Mine" count={3} accent="blue" isLoading={false}>
        <div data-testid="row-1" />
        <div data-testid="row-2" />
        <div data-testid="row-3" />
      </KanbanLane>,
    );
    expect(getByText('Mine')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="lane-count"]')?.textContent).toBe('3');
  });

  it('renders 3 children when 3 are passed', () => {
    const { container } = render(
      <KanbanLane laneId="escalated" title="Escalated" count={3} accent="rose" isLoading={false}>
        <div data-testid="row-1" />
        <div data-testid="row-2" />
        <div data-testid="row-3" />
      </KanbanLane>,
    );
    const rows = container.querySelectorAll('[data-testid^="row-"]');
    expect(rows.length).toBe(3);
  });

  it('renders KanbanEmptyState when no children are passed', () => {
    const { container } = render(
      <KanbanLane laneId="ai_drafted" title="AI drafted" count={0} accent="violet" isLoading={false} />,
    );
    // KanbanEmptyState renders a data-testid of `kanban-empty-${laneId}`
    expect(container.querySelector('[data-testid="kanban-empty-ai_drafted"]')).toBeTruthy();
  });

  it('produces 5 different accent dot classes for 5 lane accents', () => {
    const accents = ['blue', 'rose', 'violet', 'amber', 'neutral'] as const;
    const classes = new Set<string>();
    for (const accent of accents) {
      const { container } = render(
        <KanbanLane laneId="mine" title="Mine" count={0} accent={accent} isLoading={false}>
          <div />
        </KanbanLane>,
      );
      // The accent dot is the first header span (aria-hidden)
      const dot = container.querySelector('header span[aria-hidden="true"]');
      const className = dot?.className ?? '';
      // Extract the bg-{color}-500 class
      const match = className.match(/bg-\S+-\d+/);
      if (match) classes.add(match[0]);
    }
    expect(classes.size).toBe(5);
  });

  it('header has sticky positioning', () => {
    const { container } = render(
      <KanbanLane laneId="unassigned" title="Unassigned" count={0} accent="neutral" isLoading={false}>
        <div />
      </KanbanLane>,
    );
    const header = container.querySelector('header');
    expect(header?.className).toContain('sticky');
    expect(header?.className).toContain('top-0');
  });
});
