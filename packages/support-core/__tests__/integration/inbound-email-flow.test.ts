import { describe, it } from 'vitest';

/**
 * Integration tests: Inbound email flow end-to-end with mock adapters.
 *
 * These tests require a real database connection and are skipped in unit test runs.
 * They document the expected integration test scenarios for the inbound email flow.
 */

describe('Integration: Inbound Email Flow', () => {
  it.todo('receives an inbound email webhook and creates a contact, conversation, and message');

  it.todo('appends a message to an existing open conversation for the same contact and channel');

  it.todo('deduplicates a webhook with the same provider and external_message_id');

  it.todo('normalizes the sender email address to lowercase before contact lookup');

  it.todo('stores the email subject on both the conversation and message records');

  it.todo('enqueues a process_ai_message job after message insertion');

  it.todo('publishes a new_message realtime event on the organization channel');
});
