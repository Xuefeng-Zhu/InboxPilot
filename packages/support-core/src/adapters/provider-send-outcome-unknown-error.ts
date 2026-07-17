export type ProviderSendOutcomeUnknownStage = 'request' | 'response';

/** Bound outbound provider calls below typical serverless request limits. */
export const PROVIDER_SEND_TIMEOUT_MS = 15_000;

/**
 * The provider may have accepted a send, but the adapter could not obtain a
 * trustworthy provider message ID. Retrying this error as an ordinary send can
 * deliver the same customer-facing message twice.
 */
export class ProviderSendOutcomeUnknownError extends Error {
  readonly providerId: string;
  readonly stage: ProviderSendOutcomeUnknownStage;
  readonly originalError: unknown;

  constructor(details: {
    providerId: string;
    stage: ProviderSendOutcomeUnknownStage;
    message: string;
    originalError: unknown;
  }) {
    const detail = details.originalError instanceof Error
      ? details.originalError.message
      : String(details.originalError);
    super(`${details.message}: ${detail}`);
    this.name = 'ProviderSendOutcomeUnknownError';
    this.providerId = details.providerId;
    this.stage = details.stage;
    this.originalError = details.originalError;
  }
}
