/**
 * sms-status — Handles provider-authenticated SMS delivery callbacks.
 *
 * SMS adapter selection, native body parsing, and account resolution remain
 * explicit here; the shared status verification/persistence pipeline lives in
 * `_shared`.
 */

import { createProviderRegistry } from '../_shared/create-provider-registry.ts';
import {
  parseSmsWebhookBody,
  resolveSmsStatusWebhookContext,
} from '../_shared/webhook-credentials.ts';
import { createStatusWebhookHandler } from '../_shared/webhook-handler-pipelines.ts';

export default createStatusWebhookHandler({
  channel: 'sms',
  channelLabel: 'SMS',
  errorPrefix: 'sms-status',
  createAdapter: (provider) => createProviderRegistry().getSmsAdapter(provider),
  parseBody: parseSmsWebhookBody,
  resolveContext: resolveSmsStatusWebhookContext,
});
