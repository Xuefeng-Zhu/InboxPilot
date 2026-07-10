/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface WidgetWindow extends Window {
  InboxPilotWidget?: { destroy: () => void };
}

const widgetWindow = window as WidgetWindow;

describe('embeddable widget lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = [
      '<script src="https://app.example.com/widget.js"',
      ' data-widget-id="wt_demo" data-position="bottom-right"></script>',
    ].join('');
  });

  afterEach(() => {
    widgetWindow.InboxPilotWidget?.destroy();
    delete widgetWindow.InboxPilotWidget;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('replaces an existing singleton and tears down its DOM', async () => {
    await import('../../widget-src/widget');

    const firstButton = document.getElementById('inboxpilot-widget-btn');
    const firstContainer = document.getElementById('inboxpilot-widget-container');
    expect(firstButton).not.toBeNull();
    expect(firstContainer).not.toBeNull();

    vi.resetModules();
    await import('../../widget-src/widget');

    expect(document.querySelectorAll('#inboxpilot-widget-btn')).toHaveLength(1);
    expect(document.querySelectorAll('#inboxpilot-widget-container')).toHaveLength(1);
    expect(firstButton?.isConnected).toBe(false);
    expect(firstContainer?.isConnected).toBe(false);

    widgetWindow.InboxPilotWidget?.destroy();
    expect(document.getElementById('inboxpilot-widget-btn')).toBeNull();
    expect(document.getElementById('inboxpilot-widget-container')).toBeNull();
  });

  it('keeps the panel within narrow viewports', async () => {
    await import('../../widget-src/widget');

    const container = document.getElementById('inboxpilot-widget-container');
    expect(container?.style.width).toBe('380px');
    expect(container?.style.maxWidth).toBe('calc(100vw - 24px)');
    expect(container?.style.right).toBe('12px');
  });
});
