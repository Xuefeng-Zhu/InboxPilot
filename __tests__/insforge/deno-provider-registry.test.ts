import { describe, expect, it } from 'vitest';
import { PostmarkEmailAdapter } from '../../packages/support-core/src/adapters/postmark-email-adapter.ts';
import { createProviderRegistry } from '../../insforge/functions/_shared/create-provider-registry.ts';

describe('Deno provider registry', () => {
  it('registers the production Postmark email adapter', () => {
    const adapter = createProviderRegistry().getEmailAdapter('postmark');

    expect(adapter).toBeInstanceOf(PostmarkEmailAdapter);
    expect(adapter.providerId).toBe('postmark');
  });
});
