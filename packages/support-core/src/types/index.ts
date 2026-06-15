/**
 * Shared types for the support-core package.
 *
 * This file is a barrel: it re-exports from domain-grouped sub-modules so
 * external consumers keep importing from `support-core/types` and stay
 * insulated from the internal split. New domain groups belong in their own
 * sibling file (e.g. `analytics.ts`, `billing.ts`).
 */

// AI model catalog (constants + literal-union types)
export {
  CHAT_MODEL_OPTIONS,
  EMBEDDING_MODEL_OPTIONS,
  DEFAULT_CHAT_MODEL,
  DEFAULT_EMBEDDING_MODEL,
} from './ai-models';
export type { ModelId, EmbeddingModelId } from './ai-models';

// Enums / union types
export * from './enums';

// Entity types (mirror DB schema)
export * from './entities';

// Create / Input types (paired with entities)
export * from './inputs';

// Inbound webhook boundary
export * from './webhook';

// Outbound send boundary
export * from './send';

// AI client I/O
export * from './ai';

// Webchat domain (widgets + threads)
export * from './webchat';

// Query / filter shapes for repository reads
export * from './filters';
