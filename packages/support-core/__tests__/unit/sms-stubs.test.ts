import { describe, it, expect } from 'vitest';
import {
  BandwidthSmsAdapter,
  VonageSmsAdapter,
  PlivoSmsAdapter,
  MessageBirdSmsAdapter,
} from '../../src/adapters/sms-stubs.js';

const stubs = [
  { name: 'BandwidthSmsAdapter', Adapter: BandwidthSmsAdapter, providerId: 'bandwidth' },
  { name: 'VonageSmsAdapter', Adapter: VonageSmsAdapter, providerId: 'vonage' },
  { name: 'PlivoSmsAdapter', Adapter: PlivoSmsAdapter, providerId: 'plivo' },
  { name: 'MessageBirdSmsAdapter', Adapter: MessageBirdSmsAdapter, providerId: 'messagebird' },
] as const;

describe.each(stubs)('$name', ({ name, Adapter, providerId }) => {
  const adapter = new Adapter();

  it(`has providerId "${providerId}"`, () => {
    expect(adapter.providerId).toBe(providerId);
  });

  it('sendSms throws not-implemented error', async () => {
    await expect(
      adapter.sendSms({ to: '+1', from: '+2', body: 'hi', providerConfig: {} }),
    ).rejects.toThrow(`${name}.sendSms is not implemented`);
  });

  it('parseInboundWebhook throws not-implemented error', () => {
    expect(() => adapter.parseInboundWebhook({})).toThrow(
      `${name}.parseInboundWebhook is not implemented`,
    );
  });

  it('parseStatusWebhook throws not-implemented error', () => {
    expect(() => adapter.parseStatusWebhook({})).toThrow(
      `${name}.parseStatusWebhook is not implemented`,
    );
  });

  it('verifyWebhook throws not-implemented error', async () => {
    await expect(
      adapter.verifyWebhook({ headers: {}, body: '', signingSecret: '' }),
    ).rejects.toThrow(`${name}.verifyWebhook is not implemented`);
  });
});
