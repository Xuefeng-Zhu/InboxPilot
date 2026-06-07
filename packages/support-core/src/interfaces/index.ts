/**
 * Core interfaces barrel export.
 *
 * All provider-neutral abstractions are re-exported from here so that
 * consumers can import from `@inboxpilot/support-core/interfaces`.
 */

// Database
export type {
  DatabaseClient,
  QueryBuilder,
  QueryResult,
  QueryError,
} from './database-client.js';

// Secrets store
export type {
  SecretStore,
  TwilioCredentials,
} from './secret-store.js';
export { encodeTwilioCredentials, decodeTwilioCredentials } from './secret-store.js';

// SMS adapter
export type { SmsProviderAdapter } from './sms-provider-adapter.js';

// Email adapter
export type { EmailProviderAdapter } from './email-provider-adapter.js';

// Provider registry
export { ProviderRegistry } from './provider-registry.js';

// Job queue
export type { JobQueue } from './job-queue.js';

// AI client
export type { AiClient } from './ai-client.js';

// Realtime
export type { RealtimePublisher } from './realtime-publisher.js';

// Escalation
export type {
  EscalationRule,
  EscalationContext,
  EscalationResult,
} from './escalation.js';
export { EscalationEngine } from './escalation.js';
