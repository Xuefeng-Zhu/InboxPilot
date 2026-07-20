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

describe('WidgetChatPage', () => {
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

  it('requires identification even when a greeting already exists', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(
      jsonResponse({
        data: {
          requiresPreChat: true,
          thread: { identifiedAt: null },
          history: [
            {
              id: 'welcome-message',
              body: 'How can we help?',
              sender_type: 'system',
              created_at: '2026-07-20T00:00:00.000Z',
            },
          ],
        },
      }),
    )));

    render(<WidgetChatPage />);

    expect(await screen.findByLabelText('Your email')).not.toBeNull();
    expect(screen.queryByLabelText('Message input')).toBeNull();
  });

  it('resumes an identified session without showing pre-chat again', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(
      jsonResponse({
        data: {
          requiresPreChat: false,
          thread: { identifiedAt: '2026-07-20T00:00:00.000Z' },
          history: [],
        },
      }),
    )));

    render(<WidgetChatPage />);

    expect(await screen.findByLabelText('Message input')).not.toBeNull();
    expect(screen.queryByLabelText('Your email')).toBeNull();
  });

  it('recovers from a transient session load failure without reloading', async () => {
    let sessionCalls = 0;
    vi.stubGlobal('fetch', vi.fn(() => {
      sessionCalls += 1;
      if (sessionCalls === 1) {
        return Promise.reject(new Error('temporary network failure'));
      }
      return Promise.resolve(jsonResponse({
        data: {
          requiresPreChat: false,
          thread: { identifiedAt: null },
          history: [],
        },
      }));
    }));

    render(<WidgetChatPage />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Network error while loading chat.');
    const input = screen.getByLabelText('Message input') as HTMLInputElement;
    expect(input.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Retry session' }));

    await waitFor(() => {
      expect(sessionCalls).toBe(2);
      expect(screen.queryByRole('alert')).toBeNull();
      expect(input.disabled).toBe(false);
    });
  });

  it('restores a failed message and allows the visitor to dismiss or retry', async () => {
    let sendCalls = 0;
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        if (url.includes('webchat-session-info')) {
          return Promise.resolve(
            jsonResponse({
              data: {
                requiresPreChat: false,
                history: [
                  {
                    id: 'welcome-message',
                    body: 'How can we help?',
                    sender_type: 'system',
                    created_at: '2026-07-20T00:00:00.000Z',
                  },
                ],
              },
            }),
          );
        }
        if (url.includes('webchat-inbound') && init?.method === 'POST') {
          sendCalls += 1;
          if (sendCalls === 1) {
            return Promise.resolve(
              jsonResponse({ error: 'Message delivery is temporarily unavailable.' }, 503),
            );
          }
          return Promise.resolve(jsonResponse({ data: { accepted: true } }));
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<WidgetChatPage />);

    const input = await screen.findByLabelText('Message input');
    fireEvent.change(input, { target: { value: 'Please retry this message' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(
      'Message delivery is temporarily unavailable.',
    );
    expect((input as HTMLInputElement).value).toBe('Please retry this message');
    expect((input as HTMLInputElement).disabled).toBe(false);
    expect(
      (screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss send error' }));
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(sendCalls).toBe(2);
      expect((input as HTMLInputElement).value).toBe('');
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Please retry this message')).not.toBeNull();
  });
});
