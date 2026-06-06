/**
 * Realtime event publisher interface.
 *
 * Abstracts the InsForge Socket.IO realtime layer so that services
 * can publish events without importing the InsForge SDK.
 *
 * Channel naming convention: `org:{organizationId}`
 *
 * Events:
 * - `new_message` — when a message is inserted (inbound or outbound)
 * - `conversation_updated` — when conversation status or ai_state changes
 * - `knowledge_document_updated` — when document status changes
 */

export interface RealtimePublisher {
  /** Publish an event to a channel. */
  publish(channel: string, event: string, data: unknown): Promise<void>;
}
