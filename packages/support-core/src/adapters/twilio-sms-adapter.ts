/**
 * Twilio SMS provider adapter.
 *
 * Implements the full SmsProviderAdapter interface for Twilio without
 * depending on the Twilio SDK. Uses native `fetch` for HTTP calls and
 * `crypto` for HMAC-SHA1 webhook signature verification.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import type { SmsProviderAdapter } from '../interfaces/sms-provider-adapter.js';
import type {
  SendSmsParams,
  SendSmsResult,
  NormalizedInboundSms,
  NormalizedDeliveryStatus,
  WebhookVerificationRequest,
  DeliveryStatus,
} from '../types/index.js';
import { decodeTwilioCredentials, type TwilioCredentials } from '../interfaces/secret-store.js';

/**
 * Resolve a `credentialsSecretId` (a stable reference into the
 * InsForge secrets store) to the live Twilio credentials. The
 * resolver is called on every send, so a rotation that swaps the
 * secret under the same id is picked up immediately on the next
 * send. Throws when the secret cannot be found.
 */
export type TwilioCredentialResolver = (
  secretId: string,
) => Promise<TwilioCredentials>;

/**
 * Configuration for the Twilio adapter. Either provide
 * `accountSid` + `authToken` directly (legacy mode) or provide a
 * `resolveCredentials` function that maps a `credentialsSecretId` to
 * the material credentials. The resolver path is required to support
 * in-place rotation.
 */
export interface TwilioSmsAdapterConfig {
  accountSid?: string;
  authToken?: string;
  resolveCredentials?: TwilioCredentialResolver;
}

/**
 * Map Twilio MessageStatus values to our normalized DeliveryStatus.
 *
 * Twilio statuses: queued, sending, sent, delivered, undelivered, failed, canceled, read
 * Our statuses:    queued, sent, delivered, failed, bounced, pending
 */
function mapTwilioStatus(twilioStatus: string): DeliveryStatus {
  switch (twilioStatus.toLowerCase()) {
    case 'queued':
    case 'accepted':
    case 'sending':
      return 'queued';
    case 'sent':
      return 'sent';
    case 'delivered':
    case 'read':
      return 'delivered';
    case 'undelivered':
      return 'bounced';
    case 'failed':
    case 'canceled':
      return 'failed';
    default:
      return 'pending';
  }
}

/**
 * Compute the Twilio request signature for webhook verification.
 *
 * Algorithm (from Twilio docs):
 * 1. Take the full URL of the request.
 * 2. If the request is a POST, sort all POST parameters alphabetically by key.
 * 3. Append each parameter name and value (with no delimiter) to the URL.
 * 4. Sign the resulting string with HMAC-SHA1 using the auth token as the key.
 * 5. Base64-encode the hash.
 */
function computeTwilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }
  return createHmac('sha1', authToken).update(data).digest('base64');
}

/**
 * Parse a URL-encoded form body string into a key-value record.
 */
function parseFormBody(body: string): Record<string, string> {
  const params: Record<string, string> = {};
  if (!body) return params;

  const pairs = body.split('&');
  for (const pair of pairs) {
    const eqIndex = pair.indexOf('=');
    if (eqIndex === -1) {
      params[decodeURIComponent(pair)] = '';
    } else {
      const key = decodeURIComponent(pair.slice(0, eqIndex));
      const value = decodeURIComponent(pair.slice(eqIndex + 1).replace(/\+/g, ' '));
      params[key] = value;
    }
  }
  return params;
}

export class TwilioSmsAdapter implements SmsProviderAdapter {
  readonly providerId = 'twilio';

  private readonly accountSid?: string;
  private readonly authToken?: string;
  private readonly resolveCredentials?: TwilioCredentialResolver;

  /**
   * @param config - Either legacy `{ accountSid, authToken }` for
   * direct mode, or `{ resolveCredentials }` for rotation-aware mode.
   * Legacy mode is kept so existing tests and the `sms-inbound`
   * function can pass the secret material directly when needed.
   */
  constructor(config: TwilioSmsAdapterConfig = {}) {
    if (config.resolveCredentials) {
      this.resolveCredentials = config.resolveCredentials;
    } else {
      this.accountSid = config.accountSid;
      this.authToken = config.authToken;
    }
  }

  /**
   * Resolve the material credentials for a given providerConfig. The
   * config may carry either `{ accountSid, authToken }` directly or
   * a `credentialsSecretId` to look up. Returns the resolved
   * `{ accountSid, authToken }` pair.
   */
  private async resolveAuth(
    providerConfig: Record<string, unknown>,
  ): Promise<TwilioCredentials> {
    const cfg = providerConfig as {
      accountSid?: string;
      authToken?: string;
      credentialsSecretId?: string;
      resolveCredentials?: TwilioCredentialResolver;
    };

    // 0. A per-call resolver overrides the constructor-bound one
    // (useful for tests and for one-off rotations that need to
    // re-resolve with a different secret).
    const perCallResolver = cfg.resolveCredentials ?? this.resolveCredentials;

    // 1. Direct credentials on the config take precedence (legacy).
    if (typeof cfg.accountSid === 'string' && typeof cfg.authToken === 'string') {
      return { accountSid: cfg.accountSid, authToken: cfg.authToken };
    }

    // 2. credentialsSecretId path — the rotation-aware path.
    if (typeof cfg.credentialsSecretId === 'string') {
      if (!perCallResolver) {
        throw new Error(
          'TwilioSmsAdapter.sendSms: providerConfig.credentialsSecretId requires the adapter to be constructed with { resolveCredentials }',
        );
      }
      const resolved = await perCallResolver(cfg.credentialsSecretId);
      if (!resolved || !resolved.accountSid || !resolved.authToken) {
        throw new Error(
          `TwilioSmsAdapter.sendSms: resolved credentials for secret ${cfg.credentialsSecretId} are missing accountSid or authToken`,
        );
      }
      return resolved;
    }

    // 3. Fall back to the constructor-bound credentials.
    if (this.accountSid && this.authToken) {
      return { accountSid: this.accountSid, authToken: this.authToken };
    }

    throw new Error(
      'TwilioSmsAdapter.sendSms: providerConfig must contain accountSid+authToken or credentialsSecretId, and the adapter must be constructed with matching credentials',
    );
  }

  /**
   * Send an SMS via the Twilio REST API.
   *
   * providerConfig may contain:
   * - accountSid + authToken (direct)
   * - credentialsSecretId (rotation-aware; resolved via the
   *   constructor-bound `resolveCredentials`)
   * - a JSON-encoded TwilioCredentials blob under
   *   `credentialsBlob` (internal use by verifyWebhook's sign path)
   */
  async sendSms(params: SendSmsParams): Promise<SendSmsResult> {
    // The legacy code path used `params.providerConfig as { accountSid, authToken }`.
    // We keep that working, plus the new rotation-aware path.
    const cfg = (params.providerConfig ?? {}) as Record<string, unknown>;

    // Fast-path: the providerConfig already carries a JSON blob
    // (used by internal callers that have already resolved the
    // secret and want to avoid a second lookup).
    if (typeof cfg.credentialsBlob === 'string') {
      const decoded = decodeTwilioCredentials(cfg.credentialsBlob);
      return this.sendWithCreds(params, decoded.accountSid, decoded.authToken);
    }

    const { accountSid, authToken } = await this.resolveAuth(cfg);

    if (!accountSid || !authToken) {
      throw new Error('TwilioSmsAdapter.sendSms: providerConfig must contain accountSid and authToken');
    }

    return this.sendWithCreds(params, accountSid, authToken);
  }

  private async sendWithCreds(
    params: SendSmsParams,
    accountSid: string,
    authToken: string,
  ): Promise<SendSmsResult> {

    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

    const formBody = new URLSearchParams({
      To: params.to,
      From: params.from,
      Body: params.body,
    });

    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formBody.toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `TwilioSmsAdapter.sendSms: Twilio API returned ${response.status}: ${errorBody}`,
      );
    }

    const data = (await response.json()) as { sid: string; status: string };

    return {
      externalMessageId: data.sid,
      provider: this.providerId,
      status: data.status === 'queued' ? 'queued' : 'sent',
    };
  }

  /**
   * Parse a Twilio inbound SMS webhook payload into a NormalizedInboundSms.
   *
   * Twilio sends form-encoded POST bodies with fields:
   * From, To, Body, MessageSid, AccountSid, NumMedia, etc.
   *
   * The `body` parameter can be either:
   * - A URL-encoded string (raw form body)
   * - A pre-parsed object with the Twilio field names
   */
  parseInboundWebhook(body: unknown): NormalizedInboundSms {
    const payload = this.toRecord(body);

    const from = payload.From;
    const to = payload.To;
    const messageBody = payload.Body;
    const messageSid = payload.MessageSid;

    if (
      typeof from !== 'string' ||
      typeof to !== 'string' ||
      typeof messageBody !== 'string' ||
      typeof messageSid !== 'string'
    ) {
      throw new Error(
        'TwilioSmsAdapter.parseInboundWebhook: body must contain From, To, Body, and MessageSid as strings',
      );
    }

    return {
      from,
      to,
      body: messageBody,
      externalMessageId: messageSid,
      rawPayload: payload as Record<string, unknown>,
    };
  }

  /**
   * Parse a Twilio delivery status webhook payload into a NormalizedDeliveryStatus.
   *
   * Twilio sends status callbacks with:
   * MessageSid, MessageStatus, ErrorCode (optional), ErrorMessage (optional)
   */
  parseStatusWebhook(body: unknown): NormalizedDeliveryStatus {
    const payload = this.toRecord(body);

    const messageSid = payload.MessageSid;
    const messageStatus = payload.MessageStatus;

    if (typeof messageSid !== 'string' || typeof messageStatus !== 'string') {
      throw new Error(
        'TwilioSmsAdapter.parseStatusWebhook: body must contain MessageSid and MessageStatus as strings',
      );
    }

    const status = mapTwilioStatus(messageStatus);

    return {
      externalMessageId: messageSid,
      status,
      ...(typeof payload.ErrorCode === 'string' && payload.ErrorCode !== '' && {
        errorCode: payload.ErrorCode,
      }),
      ...(typeof payload.ErrorMessage === 'string' && payload.ErrorMessage !== '' && {
        errorMessage: payload.ErrorMessage,
      }),
      rawPayload: payload as Record<string, unknown>,
    };
  }

  /**
   * Verify the authenticity of a Twilio webhook request using HMAC-SHA1.
   *
   * Twilio signs requests by:
   * 1. Taking the full request URL
   * 2. Appending all POST parameters sorted alphabetically (key + value, no delimiter)
   * 3. Computing HMAC-SHA1 with the auth token as the key
   * 4. Base64-encoding the result
   *
   * The signature is sent in the `X-Twilio-Signature` header.
   *
   * The `signingSecret` in the verification request is the Twilio auth token.
   * The `body` should be the raw form-encoded POST body string.
   * The `headers` must include `x-twilio-signature` and a way to reconstruct the
   * full URL. We expect a `x-webhook-url` header or similar to carry the full URL.
   * If not present, we look for a `url` header as a fallback.
   */
  async verifyWebhook(req: WebhookVerificationRequest): Promise<boolean> {
    const signature = req.headers['x-twilio-signature'] || req.headers['X-Twilio-Signature'];
    if (!signature) {
      return false;
    }

    const authToken = req.signingSecret;
    if (!authToken) {
      return false;
    }

    // The full URL is needed for signature computation.
    // It should be provided via a header or reconstructed by the caller.
    const url = req.headers['x-webhook-url'] || req.headers['X-Webhook-Url'] || '';
    if (!url) {
      return false;
    }

    // Parse the POST body into parameters
    const bodyStr = typeof req.body === 'string' ? req.body : req.body.toString('utf-8');
    const params = parseFormBody(bodyStr);

    const expectedSignature = computeTwilioSignature(authToken, url, params);

    // Use timing-safe comparison to prevent timing attacks
    try {
      const sigBuf = Buffer.from(signature, 'base64');
      const expectedBuf = Buffer.from(expectedSignature, 'base64');

      if (sigBuf.length !== expectedBuf.length) {
        return false;
      }

      return timingSafeEqual(sigBuf, expectedBuf);
    } catch {
      return false;
    }
  }

  /**
   * Convert the incoming body to a string-keyed record.
   * Handles both pre-parsed objects and URL-encoded strings.
   */
  private toRecord(body: unknown): Record<string, string> {
    if (typeof body === 'string') {
      return parseFormBody(body);
    }
    if (typeof body === 'object' && body !== null) {
      // Already parsed — coerce values to strings for consistency
      const record: Record<string, string> = {};
      for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
        record[key] = String(value ?? '');
      }
      return record;
    }
    throw new Error('TwilioSmsAdapter: body must be a string or object');
  }
}
