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
   * The mock adapter always returns true — no signature verification needed.
   */
  async verifyWebhook(_req: WebhookVerificationRequest): Promise<boolean> {
    return true;
  }
}
