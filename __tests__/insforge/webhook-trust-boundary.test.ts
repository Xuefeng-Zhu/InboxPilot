import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('webhook handler trust boundary', () => {
  it('does not read caller-provided signing secrets in Deno webhook handlers', () => {
    const handlerUrls = [
      new URL('../../insforge/functions/sms-inbound/index.ts', import.meta.url),
      new URL('../../insforge/functions/sms-status/index.ts', import.meta.url),
      new URL('../../insforge/functions/email-inbound/index.ts', import.meta.url),
      new URL('../../insforge/functions/email-status/index.ts', import.meta.url),
    ];

    for (const handlerUrl of handlerUrls) {
      const source = readFileSync(handlerUrl, 'utf8');
      expect(source).not.toContain('x-signing-secret');
      expect(source).not.toContain("req.headers.get('apikey')");
      expect(source).not.toContain('req.headers.get("apikey")');
    }
  });

  it('keeps webhook account and signing-secret resolution centralized', () => {
    const helperSource = readFileSync(
      new URL('../../insforge/functions/_shared/webhook-credentials.ts', import.meta.url),
      'utf8',
    );

    expect(helperSource).toContain('sms_provider_accounts');
    expect(helperSource).toContain('email_provider_accounts');
    expect(helperSource).toContain('credentials_secret_id');
    expect(helperSource).toContain('getWebhookSigningSecret');
  });
});

describe('Deno job processor trust boundary', () => {
  it('does not use request headers as service-role credential fallback', () => {
    const source = readFileSync(
      new URL('../../insforge/functions/process-jobs/index.ts', import.meta.url),
      'utf8',
    );

    expect(source).not.toContain("headers.get('apikey')");
    expect(source).not.toContain('headers.get("apikey")');
  });

  it('does not keep intentionally silent catch blocks', () => {
    const source = readFileSync(
      new URL('../../insforge/functions/process-jobs/index.ts', import.meta.url),
      'utf8',
    );

    expect(source).not.toContain('catch { /* non-critical */ }');
  });
});
