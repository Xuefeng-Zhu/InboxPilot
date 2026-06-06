import { describe, it } from 'vitest';

/**
 * Integration tests: Realtime event publishing verification.
 *
 * These tests require a real InsForge instance with Realtime enabled and are
 * skipped in unit test runs. They verify that realtime events are published
 * correctly when messages are inserted and conversations are updated.
 */

describe('Integration: Realtime Event Publishing', () => {
  it.todo('publishes new_message event when an inbound SMS message is processed');

  it.todo('publishes new_message event when an outbound reply is sent');

  it.todo('publishes conversation_updated event when a conversation is escalated');

  it.todo('publishes conversation_updated event when a conversation is resolved');

  it.todo('publishes conversation_updated event when a conversation is reopened');

  it.todo('publishes conversation_updated event when AI produces a decision');

  it.todo('publishes knowledge_document_updated event when document processing completes');

  it.todo('events are published on the correct org:{organizationId} channel');
});
