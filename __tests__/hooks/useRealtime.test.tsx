/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { useRealtime } from '@/lib/use-realtime';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
}));

vi.mock('@/lib/insforge', () => ({
  insforge: {
    realtime: mocks,
  },
}));

function RealtimeHarness() {
  useRealtime({
    messageChannel: 'org:org-1',
    conversationChannel: 'org:org-1',
    onNewMessage: vi.fn(),
  });
  return null;
}

function SharedChannelHarness({ showSecond }: { showSecond: boolean }) {
  return (
    <>
      <RealtimeHarness />
      {showSecond && <RealtimeHarness />}
    </>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('useRealtime', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mocks.connect.mockReset();
    mocks.subscribe.mockReset();
    mocks.unsubscribe.mockReset();
    mocks.on.mockReset();
    mocks.off.mockReset();
  });

  it('logs subscription failures instead of leaving an unhandled rejection', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.connect.mockResolvedValue(undefined);
    mocks.subscribe.mockRejectedValue(new Error('socket down'));

    render(<RealtimeHarness />);

    await waitFor(() => {
      expect(warn).toHaveBeenCalledWith(
        'useRealtime: subscribe threw for org:org-1',
        'socket down',
      );
    });
  });

  it('unsubscribes from successfully subscribed channels on cleanup', async () => {
    mocks.connect.mockResolvedValue(undefined);
    mocks.subscribe.mockResolvedValue({ ok: true });

    const { unmount } = render(<RealtimeHarness />);

    await waitFor(() => {
      expect(mocks.subscribe).toHaveBeenCalledWith('org:org-1');
    });

    unmount();

    expect(mocks.unsubscribe).toHaveBeenCalledWith('org:org-1');
  });

  it('unsubscribes a late successful subscription after cleanup', async () => {
    const subscription = deferred<{ ok: boolean }>();
    mocks.connect.mockResolvedValue(undefined);
    mocks.subscribe.mockReturnValue(subscription.promise);

    const { unmount } = render(<RealtimeHarness />);
    await waitFor(() => {
      expect(mocks.subscribe).toHaveBeenCalledWith('org:org-1');
    });

    unmount();
    subscription.resolve({ ok: true });

    await waitFor(() => {
      expect(mocks.unsubscribe).toHaveBeenCalledWith('org:org-1');
    });
  });

  it('keeps a shared channel subscribed until its final consumer unmounts', async () => {
    mocks.connect.mockResolvedValue(undefined);
    mocks.subscribe.mockResolvedValue({ ok: true });

    const { rerender, unmount } = render(<SharedChannelHarness showSecond />);

    await waitFor(() => {
      expect(mocks.subscribe).toHaveBeenCalledTimes(1);
    });

    rerender(<SharedChannelHarness showSecond={false} />);
    expect(mocks.unsubscribe).not.toHaveBeenCalled();

    unmount();
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
    expect(mocks.unsubscribe).toHaveBeenCalledWith('org:org-1');
  });
});
