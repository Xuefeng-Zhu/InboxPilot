/**
 * InboundMessageService — orchestrates inbound message processing for SMS and email.
 *
 * Processing flow (identical for both channels):
 * 1. Check for duplicate by (provider, externalMessageId) — return existing if found
 * 2. Normalize contact identifier (phone for SMS, email for email)
 * 3. Find or create contact
 * 4. Find or create conversation (open conversation on same channel)
 * 5. Insert message
 * 6. Update conversation lastMessageAt
 * 7. Enqueue process_ai_message job
 * 8. Record audit log entry
 * 9. Return created message
 *
 * This service never imports InsForge SDK — all dependencies are injected.
 */

import type { ContactRepository } from '../repositories/contact-repository.js';
import type { ConversationRepository } from '../repositories/conversation-repository.js';
import type { MessageRepository } from '../repositories/message-repository.js';
import type { AuditLogRepository } from '../repositories/audit-log-repository.js';
import type { JobQueue } from '../interfaces/job-queue.js';
import type {
  Message,
  NormalizedInboundSms,
  NormalizedInboundEmail,
  Channel,
  Contact,
  Conversation,
} from '../types/index.js';
import { normalizePhone, normalizeEmail } from '../utils/normalization.js';

export class InboundMessageService {
  constructor(
    private contactRepo: ContactRepository,
    private conversationRepo: ConversationRepository,
    private messageRepo: MessageRepository,
    private jobQueue: JobQueue,
    private auditLog: AuditLogRepository,
  ) {}

  /**
   * Process an inbound SMS message.
   *
   * @param normalized - The normalized inbound SMS payload from the provider adapter
   * @param orgId - The organization ID that owns the receiving phone number
   * @param provider - The SMS provider identifier (e.g. 'mock', 'twilio', 'telnyx')
   * @returns The created (or existing duplicate) Message
   */
  async processInboundSms(
    normalized: NormalizedInboundSms,
    orgId: string,
    provider: string,
  ): Promise<Message> {
    return this.processInbound({
      channel: 'sms',
      provider,
      orgId,
      externalMessageId: normalized.externalMessageId,
      contactIdentifier: normalized.from,
      body: normalized.body,
      rawPayload: normalized.rawPayload,
    });
  }

  /**
   * Process an inbound email message.
   *
   * @param normalized - The normalized inbound email payload from the provider adapter
   * @param orgId - The organization ID that owns the receiving email address
   * @param provider - The email provider identifier (e.g. 'mock', 'postmark')
   * @returns The created (or existing duplicate) Message
   */
  async processInboundEmail(
    normalized: NormalizedInboundEmail,
    orgId: string,
    provider: string,
  ): Promise<Message> {
    return this.processInbound({
      channel: 'email',
      provider,
      orgId,
      externalMessageId: normalized.externalMessageId,
      contactIdentifier: normalized.from,
      body: normalized.bodyText,
      subject: normalized.subject,
      rawPayload: normalized.rawPayload,
    });
  }

  /**
   * Process an inbound webchat message.
   *
   * Unlike SMS/email, webchat skips the find-or-create contact/conversation step
   * because those are already created during thread init. Goes straight to
   * message insert + AI enqueue.
   *
   * @param params - The webchat message params (conversationId, contactId already resolved)
   * @param orgId - The organization ID
   * @returns The created Message
   */
  async processInboundWebchat(params: {
    conversationId: string;
    contactId: string;
    body: string;
    orgId: string;
    externalMessageId?: string;
  }): Promise<Message> {
    const { conversationId, contactId, body, orgId, externalMessageId } = params;

    // Dedup check if externalMessageId provided
    if (externalMessageId) {
      const existing = await this.messageRepo.findByExternalId('webchat', externalMessageId);
      if (existing) {
        return existing;
      }
    }

    // Insert message
    const message = await this.messageRepo.create({
      conversationId,
      senderType: 'contact',
      direction: 'inbound',
      channel: 'webchat',
      body,
      provider: 'webchat',
      externalMessageId: externalMessageId ?? `wc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      deliveryStatus: 'delivered',
    });

    // Update conversation lastMessageAt
    await this.conversationRepo.update(conversationId, {
      lastMessageAt: new Date(),
    });

    // Enqueue AI processing job
    await this.jobQueue.enqueue(
      'process_ai_message',
      { conversationId, messageId: message.id },
      orgId,
    );

    // Record audit log
    await this.auditLog.create({
      organizationId: orgId,
      actorType: 'system',
      action: 'message_received',
      resourceType: 'message',
      resourceId: message.id,
      metadata: { channel: 'webchat', contactId },
    });

    return message;
  }

  // ─── Private ────────────────────────────────────────────────────────

  private async processInbound(params: {
    channel: Channel;
    provider: string;
    orgId: string;
    externalMessageId: string;
    contactIdentifier: string;
    body: string;
    subject?: string;
    rawPayload: Record<string, unknown>;
  }): Promise<Message> {
    const {
      channel,
      provider,
      orgId,
      externalMessageId,
      contactIdentifier,
      body,
      subject,
      rawPayload,
    } = params;

    // 1. Check for duplicate message by (provider, externalMessageId)
    const existing = await this.messageRepo.findByExternalId(provider, externalMessageId);
    if (existing) {
      return existing;
    }

    // 2. Normalize contact identifier
    const normalizedIdentifier =
      channel === 'sms'
        ? normalizePhone(contactIdentifier)
        : normalizeEmail(contactIdentifier);

    // 3. Find or create contact
    const contact = await this.findOrCreateContact(orgId, channel, normalizedIdentifier);

    // 4. Find or create conversation
    const conversation = await this.findOrCreateConversation(orgId, contact.id, channel, subject);

    // 5. Insert message
    const message = await this.messageRepo.create({
      conversationId: conversation.id,
      senderType: 'contact',
      direction: 'inbound',
      channel,
      body,
      subject,
      rawPayload,
      provider,
      externalMessageId,
      deliveryStatus: 'delivered',
    });

    // 6. Update conversation lastMessageAt
    await this.conversationRepo.update(conversation.id, {
      lastMessageAt: new Date(),
    });

    // 7. Enqueue AI processing job
    await this.jobQueue.enqueue(
      'process_ai_message',
      { conversationId: conversation.id, messageId: message.id },
      orgId,
    );

    // 8. Record audit log
    await this.auditLog.create({
      organizationId: orgId,
      actorType: 'system',
      action: 'message_received',
      resourceType: 'message',
      resourceId: message.id,
    });

    // 9. Return the created message
    return message;
  }

  /**
   * Find an existing contact by phone or email, or create a new one.
   */
  private async findOrCreateContact(
    orgId: string,
    channel: Channel,
    normalizedIdentifier: string,
  ): Promise<Contact> {
    let contact: Contact | null;

    if (channel === 'sms') {
      contact = await this.contactRepo.findByPhone(orgId, normalizedIdentifier);
      if (!contact) {
        contact = await this.contactRepo.create({
          organizationId: orgId,
          phone: normalizedIdentifier,
        });
      }
    } else {
      contact = await this.contactRepo.findByEmail(orgId, normalizedIdentifier);
      if (!contact) {
        contact = await this.contactRepo.create({
          organizationId: orgId,
          email: normalizedIdentifier,
        });
      }
    }

    return contact;
  }

  /**
   * Find an open conversation for the contact on the same channel, or create a new one.
   */
  private async findOrCreateConversation(
    orgId: string,
    contactId: string,
    channel: Channel,
    subject?: string,
  ): Promise<Conversation> {
    const existing = await this.conversationRepo.findOpenByContactAndChannel(contactId, channel);
    if (existing) {
      return existing;
    }

    return this.conversationRepo.create({
      organizationId: orgId,
      contactId,
      channel,
      status: 'open',
      aiState: 'idle',
      subject: subject ?? null,
    });
  }
}
