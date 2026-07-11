import { afterEach, describe, expect, it, vi } from 'vitest';
import smsInboundHandler from '../../insforge/functions/sms-inbound/index.ts';
import emailInboundHandler from '../../insforge/functions/email-inbound/index.ts';
import smsStatusHandler from '../../insforge/functions/sms-status/index.ts';
import emailStatusHandler from '../../insforge/functions/email-status/index.ts';

const handlers = [
  ['SMS inbound', 'sms-inbound', smsInboundHandler],
  ['email inbound', 'email-inbound', emailInboundHandler],
  ['SMS status', 'sms-status', smsStatusHandler],
  ['email status', 'email-status', emailStatusHandler],
];

describe('inbound webhook handler security', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  for (const [label, path, handler] of handlers) {
    it(`${label} fails closed when x-provider is missing`, async () => {
      const response = await handler(new Request(
        `https://project.insforge.app/functions/${path}`,
        { method: 'POST', body: '{}' },
      ));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: 'x-provider header is required',
      });
    });

    it(`${label} rejects mock on a deployed endpoint even with local opt-in set`, async () => {
      vi.stubEnv('NEXT_PUBLIC_INSFORGE_URL', 'http://127.0.0.1:54321');
      vi.stubEnv('INBOXPILOT_ALLOW_LOCAL_MOCK_WEBHOOKS', 'true');

      const response = await handler(new Request(
        `https://project.insforge.app/functions/${path}`,
        {
          method: 'POST',
          headers: { 'x-provider': 'mock' },
          body: '{}',
        },
      ));

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toContain('disabled outside local development');
    });
  }
});
