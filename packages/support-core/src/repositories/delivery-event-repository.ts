/**
 * DeliveryEventRepository — data access for sms_delivery_events and email_delivery_events tables.
 *
 * Accepts a DatabaseClient via constructor injection (never imports InsForge SDK).
 * Handles snake_case ↔ camelCase mapping between the database and TypeScript types.
 *
 * This repository handles both SMS and email delivery events through a unified interface.
 * The channel parameter determines which underlying table is used.
 */

import type { DatabaseClient } from '../interfaces/database-client.js';
import type {
  SmsDeliveryEvent,
  EmailDeliveryEvent,
  CreateDeliveryEventInput,
  Channel,
} from '../types/index.js';

/** Unified delivery event type (SMS and email share the same shape). */
type DeliveryEvent = SmsDeliveryEvent | EmailDeliveryEvent;

/** Raw row shape shared by both sms_delivery_events and email_delivery_events. */
interface DeliveryEventRow {
  id: string;
  message_id: string;
  provider_account_id: string | null;
  status: string;
  error_code: string | null;
  error_message: string | null;
  raw_payload: Record<string, unknown>;
  created_at: string;
}

/** Convert a database row to a DeliveryEvent entity. */
function toDeliveryEvent(row: DeliveryEventRow): DeliveryEvent {
  return {
    id: row.id,
    messageId: row.message_id,
    providerAccountId: row.provider_account_id,
    status: row.status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    rawPayload: row.raw_payload,
    createdAt: new Date(row.created_at),
  };
}

/** Resolve the table name based on channel. */
function tableName(channel: Channel): string {
  return channel === 'sms' ? 'sms_delivery_events' : 'email_delivery_events';
}

export class DeliveryEventRepository {
  constructor(private db: DatabaseClient) {}

  /** Create a new delivery event record for the given channel. */
  async create(channel: Channel, input: CreateDeliveryEventInput): Promise<DeliveryEvent> {
    const row: Record<string, unknown> = {
      message_id: input.messageId,
      status: input.status,
    };

    if (input.providerAccountId !== undefined) row.provider_account_id = input.providerAccountId;
    if (input.errorCode !== undefined) row.error_code = input.errorCode;
    if (input.errorMessage !== undefined) row.error_message = input.errorMessage;
    if (input.rawPayload !== undefined) row.raw_payload = input.rawPayload;

    const { data, error } = await this.db
      .from(tableName(channel))
      .insert(row)
      .select('*')
      .single();

    if (error) {
      throw new Error(`DeliveryEventRepository.create failed: ${error.message}`);
    }

    return toDeliveryEvent(data as DeliveryEventRow);
  }

  /** Find all delivery events for a message on the given channel. */
  async findByMessageId(channel: Channel, messageId: string): Promise<DeliveryEvent[]> {
    const { data, error } = await this.db
      .from(tableName(channel))
      .select('*')
      .eq('message_id', messageId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`DeliveryEventRepository.findByMessageId failed: ${error.message}`);
    }

    const rows = (data ?? []) as DeliveryEventRow[];
    return rows.map(toDeliveryEvent);
  }
}
