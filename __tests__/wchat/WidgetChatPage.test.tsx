/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const searchParams = new URLSearchParams(
  't=visitor-token&prechat=1&color=%23123456',
);

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams,
}));

vi.mock('../../lib/use-realtime', () => ({
  useRealtime: vi.fn(),
}));

import WidgetChatPage from '../../app/wchat/[widgetId]/page';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('WidgetChatPage pre-chat identification', () => {
  beforeEach(() => {
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows identify failures, blocks duplicate submits, and allows retry', async () => {
    let resolveFirstIdentify: ((response: Response) => void) | undefined;
    const firstIdentify = new Promise<Response>((resolve) => {
      resolveFirstIdentify = resolve;
    });
    let identifyCalls = 0;

    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        if (url.includes('webchat-session-info')) {
          return Promise.resolve(jsonResponse({ data: { history: [] } }));
        }
        if (url.includes('webchat-identify') && init?.method === 'POST') {
          identifyCalls += 1;
          if (identifyCalls === 1) return firstIdentify;
          return Promise.resolve(
            jsonResponse({ data: { visitorToken: 'rotated-token' } }),
          );
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<WidgetChatPage />);

    fireEvent.change(await screen.findByLabelText('Your email'), {
      target: { value: 'visitor@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start Chat' }));

    const pendingButton = await screen.findByRole('button', {
      name: 'Starting…',
    });
    expect((pendingButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(pendingButton);
    expect(identifyCalls).toBe(1);

    resolveFirstIdentify?.(
      jsonResponse({ error: 'Identification is temporarily unavailable.' }, 503),
    );

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(
      'Identification is temporarily unavailable.',
    );
    expect(
      (screen.getByRole('button', { name: 'Start Chat' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Start Chat' }));

    await waitFor(() => {
      expect(screen.queryByLabelText('Your email')).toBeNull();
    });
    expect(identifyCalls).toBe(2);
    expect(screen.getByLabelText('Message input')).not.toBeNull();
  });
});
