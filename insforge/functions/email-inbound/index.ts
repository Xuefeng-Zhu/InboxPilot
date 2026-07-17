/**
 * email-inbound — Handles provider-authenticated inbound email webhooks.
 *
 * Channel-specific work stays here: selecting the email adapter, parsing its
 * payload, resolving the receiving address route, and choosing the email
 * service method. The shared request/auth/persistence pipeline lives in
 * `_shared`.
 */

import { createProviderRegistry } from '../_shared/create-provider-registry.ts';
import {
  parseEmailWebhookBody,
  resolveEmailInboundWebhookContext,
} from '../_shared/webhook-credentials.ts';
import { createInboundWebhookHandler } from '../_shared/webhook-handler-pipelines.ts';
import type { NormalizedInboundEmail } from '../../../packages/support-core/src/types/index.ts';

export default createInboundWebhookHandler<NormalizedInboundEmail>({
  channelLabel: 'email',
  errorPrefix: 'email-inbound',
  createAdapter: (provider) => createProviderRegistry().getEmailAdapter(provider),
  parseBody: (rawBody) => parseEmailWebhookBody(rawBody),
  destination: (normalized) => normalized.to,
  resolveContext: resolveEmailInboundWebhookContext,
  processInbound: (service, normalized, organizationId, provider) => (
    service.processInboundEmail(normalized, organizationId, provider)
  ),
});
