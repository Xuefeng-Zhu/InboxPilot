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

  it('preserves required pre-chat state when resuming a stored session', async () => {
    const payload = btoa(JSON.stringify({
      exp: Math.floor(Date.now() / 1000) + 3600,
    }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
    const token = `header.${payload}.signature`;
    localStorage.setItem('inboxpilot:visitorToken:wt_demo', token);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(
      JSON.stringify({ data: { requiresPreChat: true } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))));

    await import('../../widget-src/widget');
    document.getElementById('inboxpilot-widget-btn')?.click();

    await vi.waitFor(() => {
      expect(document.querySelector('iframe')).not.toBeNull();
    });

    const iframe = document.querySelector('iframe');
    expect(new URL(iframe?.src ?? '').searchParams.get('prechat')).toBe('1');
  });
});
