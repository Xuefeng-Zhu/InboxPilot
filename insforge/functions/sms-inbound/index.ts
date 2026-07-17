/**
 * sms-inbound — Handles provider-authenticated inbound SMS webhooks.
 *
 * Channel-specific work stays here: selecting the SMS adapter, parsing its
 * payload, resolving the receiving phone route, and choosing the SMS service
 * method. The shared request/auth/persistence pipeline lives in `_shared`.
 */

import { createProviderRegistry } from '../_shared/create-provider-registry.ts';
import {
  parseSmsWebhookBody,
  resolveSmsInboundWebhookContext,
} from '../_shared/webhook-credentials.ts';
import { createInboundWebhookHandler } from '../_shared/webhook-handler-pipelines.ts';
import type { NormalizedInboundSms } from '../../../packages/support-core/src/types/index.ts';

export default createInboundWebhookHandler<NormalizedInboundSms>({
  channelLabel: 'SMS',
  errorPrefix: 'sms-inbound',
  createAdapter: (provider) => createProviderRegistry().getSmsAdapter(provider),
  parseBody: parseSmsWebhookBody,
  destination: (normalized) => normalized.to,
  resolveContext: resolveSmsInboundWebhookContext,
  processInbound: (service, normalized, organizationId, provider) => (
    service.processInboundSms(normalized, organizationId, provider)
  ),
});
