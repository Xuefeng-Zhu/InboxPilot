/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { LandingWidget } from '../../components/landing/LandingWidget';

describe('LandingWidget', () => {
  afterEach(() => {
    window.InboxPilotWidget?.destroy();
    delete window.InboxPilotWidget;
    document.getElementById('inboxpilot-landing-widget')?.remove();
  });

  it('loads the demo widget with its configuration and destroys it on unmount', () => {
    const destroy = vi.fn();
    const { unmount } = render(<LandingWidget widgetId="wt_demo" />);

    const script = document.getElementById(
      'inboxpilot-landing-widget',
    ) as HTMLScriptElement | null;
    expect(script).not.toBeNull();
    expect(script?.getAttribute('src')).toBe('/widget.js');
    expect(script?.dataset.widgetId).toBe('wt_demo');
    expect(script?.dataset.position).toBe('bottom-right');

    window.InboxPilotWidget = { destroy };
    unmount();

    expect(destroy).toHaveBeenCalledOnce();
    expect(document.getElementById('inboxpilot-landing-widget')).toBeNull();
  });
});
