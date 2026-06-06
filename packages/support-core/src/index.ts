/**
 * @inboxpilot/support-core
 *
 * Portable business logic for the InboxPilot AI Customer Support Platform.
 * This package never imports InsForge SDK directly — all external dependencies
 * are injected via interfaces (DatabaseClient, AiClient, RealtimePublisher, etc.).
 */

// Interfaces
export * from './interfaces/index.js';

// Types
export * from './types/index.js';

// Repositories
export * from './repositories/index.js';

// Services
export * from './services/index.js';

// Adapters
export * from './adapters/index.js';

// Utils
export * from './utils/index.js';
