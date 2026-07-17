/**
 * email-status — Handles provider-authenticated email delivery callbacks.
 *
 * Email adapter selection, native body parsing, and account resolution remain
 * explicit here; the shared status verification/persistence pipeline lives in
 * `_shared`.
 */

import { createProviderRegistry } from '../_shared/create-provider-registry.ts';
import {
  parseEmailWebhookBody,
  resolveEmailStatusWebhookContext,
} from '../_shared/webhook-credentials.ts';
import { createStatusWebhookHandler } from '../_shared/webhook-handler-pipelines.ts';

export default createStatusWebhookHandler({
  channel: 'email',
  channelLabel: 'email',
  errorPrefix: 'email-status',
  createAdapter: (provider) => createProviderRegistry().getEmailAdapter(provider),
  parseBody: (rawBody) => parseEmailWebhookBody(rawBody),
  resolveContext: resolveEmailStatusWebhookContext,
});
