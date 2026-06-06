import { describe, it } from 'vitest';

/**
 * Integration tests: Outbound message flow with mock adapter.
 *
 * These tests require a real database connection and are skipped in unit test runs.
 * They document the expected integration test scenarios for outbound message sending.
 */

describe('Integration: Outbound Message Flow', () => {
  it.todo('sends an SMS reply via the mock adapter and stores the outbound message');

  it.todo('sends an email reply via the mock adapter and stores the outbound message');

  it.todo('records the provider, provider_account_id, and external_message_id on the message');

  it.todo('updates the conversation last_message_at timestamp');

  it.todo('records an audit log entry for message_sent');

  it.todo('publishes a new_message realtime event on the organization channel');

  it.todo('throws when no default phone number or email address is configured');
});
