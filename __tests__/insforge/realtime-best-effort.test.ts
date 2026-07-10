import { describe, expect, it, vi } from 'vitest';
import { publishRealtimeBestEffort } from '../../insforge/functions/_shared/publish-realtime-best-effort';
import type { RealtimePublisher } from '../../packages/support-core/src/interfaces/realtime-publisher';

describe('publishRealtimeBestEffort', () => {
  it('reports a successful publish', async () => {
    const realtime: RealtimePublisher = {
      publish: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      publishRealtimeBestEffort(
        realtime,
        'org:org-1',
        'new_message',
        { messageId: 'message-1' },
        'test publish',
      ),
    ).resolves.toBe(true);
  });

  it('contains publish failures so completed work is not retried', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const realtime: RealtimePublisher = {
      publish: vi.fn().mockRejectedValue(new Error('socket unavailable')),
    };

    await expect(
      publishRealtimeBestEffort(
        realtime,
        'org:org-1',
        'new_message',
        { messageId: 'message-1' },
        'test publish',
      ),
    ).resolves.toBe(false);
    expect(error).toHaveBeenCalledWith(
      'test publish: realtime publish failed for org:org-1/new_message: socket unavailable',
    );
  });
});
