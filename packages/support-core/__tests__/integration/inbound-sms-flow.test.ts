import { describe, it } from 'vitest';

/**
 * Integration tests: Inbound SMS flow end-to-end with mock adapters.
 *
 * These tests require a real database connection and are skipped in unit test runs.
 * They document the expected integration test scenarios for the inbound SMS flow.
 */

describe('Integration: Inbound SMS Flow', () => {
  it.todo('receives an inbound SMS webhook and creates a contact, conversation, and message');

  it.todo('appends a message to an existing open conversation for the same contact');

  it.todo('deduplicates a webhook with the same provider and external_message_id');

  it.todo('enqueues a process_ai_message job after message insertion');

  it.todo('publishes a new_message realtime event on the organization channel');

  it.todo('returns 401 when webhook signature verification fails');

  it.todo('returns 404 when the receiving phone number is not registered');
});
