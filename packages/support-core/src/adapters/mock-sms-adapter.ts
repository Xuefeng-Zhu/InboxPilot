/**
 * Mock SMS provider adapter for testing.
 *
 * Implements the full SmsProviderAdapter interface with in-memory storage.
 * Sent messages are stored in a `sentMessages` array for test assertions,
 * and `externalMessageId` values are deterministic (`mock_sms_1`, `mock_sms_2`, …).
 */

import type { SmsProviderAdapter } from '../interfaces/sms-provider-adapter.js';
import type {
  SendSmsParams,
  SendSmsResult,
  NormalizedInboundSms,
  NormalizedDeliveryStatus,
  WebhookVerificationRequest,
  DeliveryStatus,
} from '../types/index.js';

/** Shape of a message stored by the mock adapter. */
export interface MockSentSms {
  to: string;
  from: string;
  body: string;
  externalMessageId: string;
}

export class MockSmsAdapter implements SmsProviderAdapter {
  readonly providerId = 'mock';

  private _sentMessages: MockSentSms[] = [];
  private _counter = 0;

  /** Readonly view of all messages sent through this adapter. */
  get sentMessages(): readonly MockSentSms[] {
    return this._sentMessages;
  }

  /** Reset the in-memory store and counter. */
  clear(): void {
    this._sentMessages = [];
    this._counter = 0;
  }

  /**
   * Simulate sending an SMS.
   * Stores the message in memory and returns a deterministic externalMessageId.
   */
  async sendSms(params: SendSmsParams): Promise<SendSmsResult> {
    this._counter += 1;
    const externalMessageId = `mock_sms_${this._counter}`;

    this._sentMessages.push({
      to: params.to,
      from: params.from,
      body: params.body,
      externalMessageId,
    });

    return {
      externalMessageId,
      provider: this.providerId,
      status: 'queued',
    };
  }

  /**
   * Parse a raw inbound webhook body into a NormalizedInboundSms.
   *
   * Expects `body` to be an object with `{ from, to, body, messageId }`.
   */
  parseInboundWebhook(body: unknown): NormalizedInboundSms {
    const payload = body as Record<string, unknown>;

    if (
      typeof payload !== 'object' ||
      payload === null ||
      typeof payload.from !== 'string' ||
      typeof payload.to !== 'string' ||
      typeof payload.body !== 'string' ||
      typeof payload.messageId !== 'string'
    ) {
      throw new Error(
        'MockSmsAdapter.parseInboundWebhook: body must contain from, to, body, and messageId as strings',
      );
    }

    return {
      from: payload.from as string,
      to: payload.to as string,
      body: payload.body as string,
      externalMessageId: payload.messageId as string,
      rawPayload: payload as Record<string, unknown>,
    };
  }

  /**
   * Parse a raw delivery-status webhook body into a NormalizedDeliveryStatus.
   *
   * Expects `body` to be an object with `{ messageId, status, errorCode?, errorMessage? }`.
   */
  parseStatusWebhook(body: unknown): NormalizedDeliveryStatus {
    const payload = body as Record<string, unknown>;

    if (
      typeof payload !== 'object' ||
      payload === null ||
      typeof payload.messageId !== 'string' ||
      typeof payload.status !== 'string'
    ) {
      throw new Error(
        'MockSmsAdapter.parseStatusWebhook: body must contain messageId and status as strings',
      );
    }

    const validStatuses: DeliveryStatus[] = [
      'queued',
      'sent',
      'delivered',
      'failed',
      'bounced',
    ];
    const status = payload.status as string;
    if (!validStatuses.includes(status as DeliveryStatus)) {
      throw new Error(
        `MockSmsAdapter.parseStatusWebhook: invalid status "${status}". Must be one of: ${validStatuses.join(', ')}`,
      );
    }

    return {
      externalMessageId: payload.messageId as string,
      status: status as DeliveryStatus,
      ...(typeof payload.errorCode === 'string' && {
        errorCode: payload.errorCode,
      }),
      ...(typeof payload.errorMessage === 'string' && {
        errorMessage: payload.errorMessage,
      }),
      rawPayload: payload as Record<string, unknown>,
    };
  }

  /**
   * Verify webhook authenticity.
   *
   * The mock adapter is intended ONLY for local development, unit tests, and
   * CI integration tests. It must never be reachable from a deployed
   * environment without an explicit test-only signing secret.
   *
   * Reads the test secret from `MOCK_WEBHOOK_SECRET` (via `Deno.env` or
   * `process.env`). If the secret env var is unset, the adapter rejects every
   * webhook call. If it is set, the caller-supplied `signingSecret` header
   * must match exactly (constant-time compare to avoid timing leaks).
   *
   * CRITICAL-1 mitigation: the entrypoint layer also refuses `x-provider:
   * mock` when `ENV === 'production'`, so this is defense in depth — even if
   * the secret leaks, production cannot route through the mock.
   */
  async verifyWebhook(req: WebhookVerificationRequest): Promise<boolean> {
    const expectedSecret = readMockSecret();
    if (!expectedSecret) {
      // No test secret configured — never accept any webhook in this environment.
      return false;
    }
    if (typeof req.signingSecret !== 'string' || req.signingSecret.length === 0) {
      return false;
    }
    return timingSafeEqual(req.signingSecret, expectedSecret);
  }
}

// ---------------------------------------------------------------------------
// Helpers (module-private)
// ---------------------------------------------------------------------------

/**
 * Read the mock-adapter webhook test secret from the runtime environment.
 * Returns `null` if not configured. Reads from `process.env` — the mock
 * adapter lives in `support-core` which must remain Deno-agnostic, and Deno
 * exposes `process.env` as a Node-compatible polyfill.
 */
function readMockSecret(): string | null {
  if (typeof process === 'undefined' || !process.env) {
    return null;
  }
  const value = process.env.MOCK_WEBHOOK_SECRET;
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  return value;
}

/**
 * Constant-time string compare. Returns false on length mismatch without
 * short-circuiting.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    let dummy = 0;
    const max = Math.max(a.length, b.length);
    for (let i = 0; i < max; i++) {
      dummy |= (a.charCodeAt(i % a.length) ^ b.charCodeAt(i % b.length));
    }
    if (dummy === 0xdeadbeef) return true;
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
