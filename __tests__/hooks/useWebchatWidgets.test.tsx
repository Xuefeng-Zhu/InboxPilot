/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  useWebchatWidgets,
  WEBCHAT_WIDGET_SAFE_COLUMNS,
  type WebchatWidgetRow,
} from '../../app/settings/_components/useWebchatWidgets';

const mocks = vi.hoisted(() => ({
  order: vi.fn(),
  select: vi.fn(),
}));

vi.mock('@/lib/insforge', () => ({
  getAccessToken: vi.fn(() => null),
  insforge: {
    database: {
      from: vi.fn(() => ({
        select: mocks.select.mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: mocks.order,
      })),
    },
  },
}));

function widget(id: string, organizationId: string): WebchatWidgetRow {
  return {
    id,
    organization_id: organizationId,
    name: id,
    widget_token: `token-${id}`,
    allowed_domains: [],
    position: 'bottom-right',
    primary_color: null,
    greeting: null,
    pre_chat_enabled: false,
    ai_mode_override: null,
    is_active: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('useWebchatWidgets', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('settles loading and refreshes when an organization arrives after mount', async () => {
    mocks.order.mockResolvedValue({ data: [widget('widget-1', 'org-1')], error: null });
    const { result, rerender } = renderHook(
      ({ orgId }: { orgId: string | null }) => useWebchatWidgets(orgId),
      { initialProps: { orgId: null as string | null } },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ orgId: 'org-1' });

    await waitFor(() => expect(result.current.widgets).toHaveLength(1));
    expect(result.current.widgets[0].organization_id).toBe('org-1');
    expect(mocks.select).toHaveBeenCalledWith(WEBCHAT_WIDGET_SAFE_COLUMNS);
    expect(WEBCHAT_WIDGET_SAFE_COLUMNS).not.toContain('hmac_secret');
  });

  it('ignores a stale response after the organization changes', async () => {
    const first = deferred<{ data: WebchatWidgetRow[]; error: null }>();
    const second = deferred<{ data: WebchatWidgetRow[]; error: null }>();
    mocks.order
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { result, rerender } = renderHook(
      ({ orgId }: { orgId: string | null }) => useWebchatWidgets(orgId),
      { initialProps: { orgId: 'org-1' } },
    );
    rerender({ orgId: 'org-2' });

    second.resolve({ data: [widget('widget-2', 'org-2')], error: null });
    await waitFor(() => expect(result.current.widgets[0]?.id).toBe('widget-2'));

    first.resolve({ data: [widget('widget-1', 'org-1')], error: null });
    await Promise.resolve();
    expect(result.current.widgets[0]?.id).toBe('widget-2');
  });
});
