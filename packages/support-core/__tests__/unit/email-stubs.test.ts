import { describe, it, expect } from 'vitest';
import {
  MailgunEmailAdapter,
  ResendEmailAdapter,
  AwsSesEmailAdapter,
  InsForgeEmailAdapter,
} from '../../src/adapters/email-stubs.js';

const stubs = [
  { name: 'MailgunEmailAdapter', Adapter: MailgunEmailAdapter, providerId: 'mailgun' },
  { name: 'ResendEmailAdapter', Adapter: ResendEmailAdapter, providerId: 'resend' },
  { name: 'AwsSesEmailAdapter', Adapter: AwsSesEmailAdapter, providerId: 'aws-ses' },
  { name: 'InsForgeEmailAdapter', Adapter: InsForgeEmailAdapter, providerId: 'insforge' },
] as const;

describe.each(stubs)('$name', ({ name, Adapter, providerId }) => {
  const adapter = new Adapter();

  it(`has providerId "${providerId}"`, () => {
    expect(adapter.providerId).toBe(providerId);
  });

  it('sendEmail throws not-implemented error', async () => {
    await expect(
      adapter.sendEmail({
        to: 'a@b.com',
        from: 'c@d.com',
        subject: 'Test',
        bodyText: 'hello',
        providerConfig: {},
      }),
    ).rejects.toThrow(`${name}.sendEmail is not implemented`);
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
