/**
 * @vitest-environment jsdom
 */
import React, { act, useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SidebarCollapseToggle } from '../../components/layout/SidebarCollapseToggle';

// Radix's use-size hook needs ResizeObserver when the Tooltip portal mounts
// after hover. jsdom does not provide it natively.
class ResizeObserverPolyfill {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverPolyfill);

describe('SidebarCollapseToggle — expanded mode', () => {
  it('has aria-expanded="true", aria-label="Collapse sidebar", and "Collapse" text', () => {
    render(<SidebarCollapseToggle collapsed={false} onToggle={vi.fn()} />);
    const toggle = screen.getByRole('button', { name: /collapse sidebar/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('Collapse sidebar');
    expect(toggle.getAttribute('aria-controls')).toBe('primary-sidebar');
    expect(toggle.getAttribute('data-testid')).toBe('sidebar-collapse-toggle');
    expect(toggle.getAttribute('data-state')).toBe('expanded');
    expect(screen.getByText('Collapse')).toBeInTheDocument();
  });
});

describe('SidebarCollapseToggle — collapsed mode', () => {
  it('has aria-expanded="false", aria-label="Expand sidebar", and a Tooltip', () => {
    // The Radix Tooltip only mounts its portal content after the user hovers
    // (delayDuration=200). Use fake timers so we can synchronously advance
    // past the delay and assert the tooltip text is in the document.
    vi.useFakeTimers();
    try {
      render(<SidebarCollapseToggle collapsed={true} onToggle={vi.fn()} />);
      const toggle = screen.getByRole('button', { name: /expand sidebar/i });
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(toggle.getAttribute('aria-label')).toBe('Expand sidebar');
      expect(toggle.getAttribute('aria-controls')).toBe('primary-sidebar');
      expect(toggle.getAttribute('data-testid')).toBe('sidebar-collapse-toggle');
      expect(toggle.getAttribute('data-state')).toBe('collapsed');
      expect(screen.queryByText('Collapse')).toBeNull();

      // Open the tooltip by hovering the trigger, then advance past the
      // Radix open-delay so the Portal mounts its Content into the DOM.
      fireEvent.pointerMove(toggle);
      act(() => {
        vi.advanceTimersByTime(500);
      });

      // The Radix Tooltip renders its content into a Portal; once open the
      // "Expand sidebar" text is in document.body.textContent.
      expect(document.body.textContent).toContain('Expand sidebar');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('SidebarCollapseToggle — click behavior', () => {
  it('fires onToggle exactly once per click', () => {
    const onToggle = vi.fn();
    render(<SidebarCollapseToggle collapsed={false} onToggle={onToggle} />);
    const toggle = screen.getByRole('button', { name: /collapse sidebar/i });
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(2);
  });
});

describe('SidebarCollapseToggle — parent state change', () => {
  it('re-renders with flipped a11y attrs when collapsed prop changes', () => {
    function Harness() {
      const [collapsed, setCollapsed] = useState(false);
      return (
        <div>
          <SidebarCollapseToggle collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
          <span data-testid="state">{collapsed ? 'collapsed' : 'expanded'}</span>
        </div>
      );
    }
    render(<Harness />);
    // Initial: expanded mode
    const toggle = screen.getByRole('button', { name: /collapse sidebar/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('state').textContent).toBe('expanded');
    // Click to flip → collapsed mode
    fireEvent.click(toggle);
    const toggle2 = screen.getByRole('button', { name: /expand sidebar/i });
    expect(toggle2.getAttribute('aria-expanded')).toBe('false');
    expect(toggle2.getAttribute('aria-label')).toBe('Expand sidebar');
    expect(screen.getByTestId('state').textContent).toBe('collapsed');
    // Click again → back to expanded
    fireEvent.click(toggle2);
    const toggle3 = screen.getByRole('button', { name: /collapse sidebar/i });
    expect(toggle3.getAttribute('aria-expanded')).toBe('true');
    expect(toggle3.getAttribute('aria-label')).toBe('Collapse sidebar');
    expect(screen.getByTestId('state').textContent).toBe('expanded');
  });
});
