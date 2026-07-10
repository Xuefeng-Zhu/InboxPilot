import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishRealtimeMessage } from '@/lib/realtime-publisher';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock('@/lib/insforge-admin', () => ({
  insforgeAdmin: {
    database: {
      rpc: mocks.rpc,
    },
  },
}));

describe('publishRealtimeMessage', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_INSFORGE_URL = 'https://example.insforge.app';
    process.env.INSFORGE_SERVICE_ROLE_KEY = 'service-role-key';
    mocks.rpc.mockResolvedValue({ data: 'event-id', error: null });
  });

  afterEach(() => {
    mocks.rpc.mockReset();
    delete process.env.NEXT_PUBLIC_INSFORGE_URL;
    delete process.env.INSFORGE_SERVICE_ROLE_KEY;
  });

  it('publishes through the InsForge database RPC', async () => {
    await publishRealtimeMessage('widget:widget-1:jti-1', 'new_message', {
      message: { id: 'msg-1' },
    });

    expect(mocks.rpc).toHaveBeenCalledWith('publish_realtime_message', {
      p_channel_name: 'widget:widget-1:jti-1',
      p_event_name: 'new_message',
      p_payload: { message: { id: 'msg-1' } },
    });
  });

  it('throws when required server config is missing', async () => {
    delete process.env.INSFORGE_SERVICE_ROLE_KEY;

    await expect(
      publishRealtimeMessage('org:org-1', 'new_message', {}),
    ).rejects.toThrow('INSFORGE_SERVICE_ROLE_KEY');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('surfaces RPC errors to the caller', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'permission denied' },
    });

    await expect(
      publishRealtimeMessage('org:org-1', 'new_message', {}),
    ).rejects.toThrow('permission denied');
  });
});
