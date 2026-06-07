/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { StatusBadge } from '../../components/ui/StatusBadge';

describe('StatusBadge', () => {
  const statuses = ['open', 'escalated', 'resolved', 'ai_draft', 'connected', 'disconnected'] as const;

  it.each(statuses)('renders %s status with pill shape classes', (status) => {
    const { container } = render(<StatusBadge status={status} />);
    const span = container.querySelector('span')!;
    expect(span.className).toContain('rounded-full');
    expect(span.className).toContain('px-2');
    expect(span.className).toContain('py-0.5');
    expect(span.className).toContain('text-xs');
    expect(span.className).toContain('font-medium');
  });

  it('renders open with orange colors', () => {
    const { container } = render(<StatusBadge status="open" />);
    const span = container.querySelector('span')!;
    expect(span.className).toContain('bg-orange-50');
    expect(span.className).toContain('text-orange-700');
  });

  it('renders escalated with red colors', () => {
    const { container } = render(<StatusBadge status="escalated" />);
    const span = container.querySelector('span')!;
    expect(span.className).toContain('bg-red-50');
    expect(span.className).toContain('text-red-700');
  });

  it('renders resolved with green colors', () => {
    const { container } = render(<StatusBadge status="resolved" />);
    const span = container.querySelector('span')!;
    expect(span.className).toContain('bg-green-50');
    expect(span.className).toContain('text-green-700');
  });

  it('renders ai_draft with purple colors', () => {
    const { container } = render(<StatusBadge status="ai_draft" />);
    const span = container.querySelector('span')!;
    expect(span.className).toContain('bg-purple-50');
    expect(span.className).toContain('text-purple-700');
  });

  it('renders connected with green colors', () => {
    const { container } = render(<StatusBadge status="connected" />);
    const span = container.querySelector('span')!;
    expect(span.className).toContain('bg-green-50');
    expect(span.className).toContain('text-green-700');
  });

  it('renders disconnected with red colors', () => {
    const { container } = render(<StatusBadge status="disconnected" />);
    const span = container.querySelector('span')!;
    expect(span.className).toContain('bg-red-50');
    expect(span.className).toContain('text-red-700');
  });

  it('formats status text: replaces underscores and capitalizes first letter', () => {
    const { container } = render(<StatusBadge status="ai_draft" />);
    expect(container.textContent).toBe('Ai draft');
  });

  it('formats single-word status with capitalized first letter', () => {
    const { container } = render(<StatusBadge status="open" />);
    expect(container.textContent).toBe('Open');
  });

  it('accepts className prop for layout overrides', () => {
    const { container } = render(<StatusBadge status="open" className="ml-2" />);
    const span = container.querySelector('span')!;
    expect(span.className).toContain('ml-2');
  });
});
