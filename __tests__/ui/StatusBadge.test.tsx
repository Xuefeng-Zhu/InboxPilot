/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { StatusBadge } from '../../components/ui/StatusBadge';

describe('StatusBadge (M03)', () => {
  const statuses = ['open', 'escalated', 'resolved', 'ai_draft', 'connected', 'disconnected'] as const;

  it.each(statuses)('renders %s status with mono square badge classes', (status) => {
    const { container } = render(<StatusBadge status={status} />);
    const span = container.querySelector('span')!;
    expect(span.className).toContain('rounded-[3px]');
    expect(span.className).toContain('px-1.5');
    expect(span.className).toContain('py-px');
    expect(span.className).toContain('font-mono');
    expect(span.className).toContain('uppercase');
  });

  it('renders open with outlined gray (M03)', () => {
    const { container } = render(<StatusBadge status="open" />);
    const span = container.querySelector('span')!;
    expect(span.className).toContain('bg-white');
    expect(span.className).toContain('text-[var(--m03-fg-2)]');
    expect(span.className).toContain('border');
  });

  it('renders escalated with red colors', () => {
    const { container } = render(<StatusBadge status="escalated" />);
    const span = container.querySelector('span')!;
    expect(span.className).toContain('bg-[var(--m03-red-fill)]');
    expect(span.className).toContain('text-[var(--m03-red)]');
  });

  it('renders resolved with green colors', () => {
    const { container } = render(<StatusBadge status="resolved" />);
    const span = container.querySelector('span')!;
    expect(span.className).toContain('bg-[var(--m03-green-fill)]');
    expect(span.className).toContain('text-[var(--m03-green)]');
  });

  it('renders ai_draft with orange colors', () => {
    const { container } = render(<StatusBadge status="ai_draft" />);
    const span = container.querySelector('span')!;
    expect(span.className).toContain('bg-[var(--m03-orange-fill)]');
    expect(span.className).toContain('text-[var(--m03-orange)]');
  });

  it('renders connected with green colors', () => {
    const { container } = render(<StatusBadge status="connected" />);
    const span = container.querySelector('span')!;
    expect(span.className).toContain('bg-[var(--m03-green-fill)]');
    expect(span.className).toContain('text-[var(--m03-green)]');
  });

  it('renders disconnected with red colors', () => {
    const { container } = render(<StatusBadge status="disconnected" />);
    const span = container.querySelector('span')!;
    expect(span.className).toContain('bg-[var(--m03-red-fill)]');
    expect(span.className).toContain('text-[var(--m03-red)]');
  });

  it('renders ai_draft label as "AI draft"', () => {
    const { container } = render(<StatusBadge status="ai_draft" />);
    expect(container.textContent).toBe('AI draft');
  });

  it('renders open label as "Open"', () => {
    const { container } = render(<StatusBadge status="open" />);
    expect(container.textContent).toBe('Open');
  });

  it('accepts className prop for layout overrides', () => {
    const { container } = render(<StatusBadge status="open" className="ml-2" />);
    const span = container.querySelector('span')!;
    expect(span.className).toContain('ml-2');
  });
});
