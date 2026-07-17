/**
 * OutboundMessageService — orchestrates sending outbound replies over SMS,
 * email, or webchat.
 *
 * sendReply flow:
 * 1. Load conversation by ID
 * 2. Determine channel from conversation (sms, email, or webchat)
 * 3. Load the contact to get the recipient address (phone or email)
 * 4. If SMS: find default phone number, get SMS adapter, call sendSms
 * 5. If email: find default email address, get email adapter, call sendEmail
 * 6. If webchat: skip the external provider — synthesize provider-stub
 *    fields locally (no realtime publish here, see contract note below)
 * 7. Create outbound message record with provider, providerAccountId,
 *    externalMessageId
 * 8. Update conversation lastMessageAt
 * 9. Record audit log entry for 'message_sent'
 * 10. Return the created message
 *
 * Contract — realtime publishing is the caller's responsibility:
 * This service never publishes a realtime event. For the webchat channel the
 * caller (the route or the Deno function) must publish the `new_message`
 * event itself with the correct `senderType` for the widget payload:
 *   - `app/api/functions/send-reply` → 'user' (human agent reply)
 *   - `app/api/functions/approve-ai-draft` → 'ai' (approved AI draft)
 *   - `insforge/functions/process-jobs#send_outbound_message` → 'ai'
 * Hard-coding the sender type inside the service was unsafe because the
 * service cannot tell a human reply from an AI auto-reply.
 *
 * This service never imports InsForge SDK — all dependencies are injected.
 */

import type { ConversationRepository } from '../repositories/conversation-repository.js';
import type { ContactRepository } from '../repositories/contact-repository.js';
import type { MessageRepository } from '../repositories/message-repository.js';
import type { AuditLogRepository } from '../repositories/audit-log-repository.js';
import type { SmsProviderAccountRepository } from '../repositories/sms-provider-account-repository.js';
import type { EmailProviderAccountRepository } from '../repositories/email-provider-account-repository.js';
import type { ProviderRegistry } from '../interfaces/provider-registry.js';
import type { Message } from '../types/index.js';

/**
 * Identity attached to a persisted outbound message and its default audit row.
 *
 * Keeping the sender type and nullable ID together prevents automation callers
 * from passing `null` through a parameter that was typed as a human user ID,
 * while still allowing an approving user to be recorded on an AI-authored
 * draft.
 */
export type OutboundMessageActor =
  | { type: 'user'; id: string }
  | { type: 'ai'; id: string | null }
  | { type: 'system'; id: string | null };

export type OutboundMessageFinalizationStage =
  | 'message_persistence'
  | 'conversation_update'
  | 'audit_log';

export interface OutboundDispatchReceipt {
  channel: Message['channel'];
  provider: string;
  providerAccountId: string | null;
  externalMessageId: string;
  deliveryStatus: 'queued' | 'sent';
}

/**
 * Delivery crossed its retry-safe boundary, but a local finalization step
 * failed. For SMS/email that boundary is provider acceptance; for webchat it
 * is creation of the outbound message row. Callers must not make the draft
 * retryable because doing so can send the customer a duplicate reply.
 */
export class OutboundMessagePostDispatchError extends Error {
  readonly originalError: unknown;
  readonly stage: OutboundMessageFinalizationStage;
  readonly dispatchedMessage: Message | null;
  readonly receipt: OutboundDispatchReceipt;

  constructor(details: {
    originalError: unknown;
    stage: OutboundMessageFinalizationStage;
    dispatchedMessage: Message | null;
    receipt: OutboundDispatchReceipt;
  }) {
    const { originalError, stage, dispatchedMessage, receipt } = details;
    const detail = originalError instanceof Error
      ? originalError.message
      : String(originalError);
    super(`Message delivery reached ${stage} before local finalization failed: ${detail}`);
    this.name = 'OutboundMessagePostDispatchError';
    this.originalError = originalError;
    this.stage = stage;
    this.dispatchedMessage = dispatchedMessage;
    this.receipt = receipt;
  }
}

export class OutboundMessageService {
  constructor(
    private conversationRepo: ConversationRepository,
    private contactRepo: ContactRepository,
    private messageRepo: MessageRepository,
    private providerRegistry: ProviderRegistry,
    private smsAccountRepo: SmsProviderAccountRepository,
    private emailAccountRepo: EmailProviderAccountRepository,
    private auditLog: AuditLogRepository,
  ) {}

  /**
   * Send a reply message on an existing conversation.
   *
   * @param conversationId - The conversation to reply on
   * @param body - The message body text
   * @param actor - The user, AI, or system identity sending the reply
   * @param providerConfig - Per-call credentials for the provider adapter
   *   (e.g. `{ accountSid, authToken }` for Twilio, `{ serverToken }` for
   *   Postmark, `{ apiKey }` for Telnyx). The Mock adapter ignores it.
   *   Optional — when omitted, defaults to `{}`, which is correct for the
   *   Mock adapter and for environments that configure credentials via the
   *   adapter constructor (none of the current adapters do).
   * @param options - Optional behavior flags:
   *   - `writeAuditLog` (default `true`): when `false`, the service skips
   *     its own `message_sent` audit entry. Callers that need a specialized
   *     event (AI auto-reply metadata or draft approval) pass
   *     `writeAuditLog: false` and write that event themselves. Realtime
   *     publishing for AI auto-replies also lives in that caller (with
   *     `senderType: 'ai'`), since the service no longer publishes
   *     realtime itself.
   * @returns The created outbound Message
   */
  async sendReply(
    conversationId: string,
    body: string,
    actor: OutboundMessageActor,
    providerConfig: Record<string, unknown> = {},
    options: { writeAuditLog?: boolean } = {},
  ): Promise<Message> {
    // 1. Load conversation
    const conversation = await this.conversationRepo.findById(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    // 2. Load the contact to get recipient address
    const contact = await this.contactRepo.findById(conversation.contactId);
    if (!contact) {
      throw new Error(`Contact not found: ${conversation.contactId}`);
    }

    // 3. Determine channel and send
    const { channel, organizationId } = conversation;

    let provider: string;
    let providerAccountId: string | null;
    let externalMessageId: string;
    let deliveryStatus: 'queued' | 'sent';
    let externalProviderAccepted = false;

    if (channel === 'sms') {
      // 4a. Find default phone number for the org
      const defaultPhone = await this.smsAccountRepo.findDefaultPhoneNumber(organizationId);
      if (!defaultPhone) {
        throw new Error(`No default SMS phone number configured for organization: ${organizationId}`);
      }

      // 4b. Look up the provider account to get the provider name
      const smsAccount = await this.smsAccountRepo.findById(defaultPhone.providerAccountId);
      if (!smsAccount) {
        throw new Error(`SMS provider account not found: ${defaultPhone.providerAccountId}`);
      }

      // 4c. Get the SMS adapter and send
      const recipientPhone = contact.phone;
      if (!recipientPhone) {
        throw new Error(`Contact ${contact.id} has no phone number for SMS reply`);
      }

      const smsAdapter = this.providerRegistry.getSmsAdapter(smsAccount.provider);
      const sendResult = await smsAdapter.sendSms({
        to: recipientPhone,
        from: defaultPhone.phoneNumber,
        body,
        providerConfig,
      });
      externalProviderAccepted = true;

      provider = sendResult.provider;
      providerAccountId = smsAccount.id;
      externalMessageId = sendResult.externalMessageId;
      deliveryStatus = sendResult.status;
    } else if (channel === 'email') {
      // 5a. Find default email address for the org
      const defaultEmail = await this.emailAccountRepo.findDefaultEmailAddress(organizationId);
      if (!defaultEmail) {
        throw new Error(`No default email address configured for organization: ${organizationId}`);
      }

      // 5b. Look up the provider account to get the provider name
      const emailAccount = await this.emailAccountRepo.findById(defaultEmail.providerAccountId);
      if (!emailAccount) {
        throw new Error(`Email provider account not found: ${defaultEmail.providerAccountId}`);
      }

      // 5c. Get the email adapter and send
      const recipientEmail = contact.email;
      if (!recipientEmail) {
        throw new Error(`Contact ${contact.id} has no email address for email reply`);
      }

      const emailAdapter = this.providerRegistry.getEmailAdapter(emailAccount.provider);
      const sendResult = await emailAdapter.sendEmail({
        to: recipientEmail,
        from: defaultEmail.emailAddress,
        subject: conversation.subject ?? 'Re: Support',
        bodyText: body,
        providerConfig,
      });
      externalProviderAccepted = true;

      provider = sendResult.provider;
      providerAccountId = emailAccount.id;
      externalMessageId = sendResult.externalMessageId;
      deliveryStatus = sendResult.status;
    } else {
      // channel === 'webchat'
      // No external provider call — the service persists the outbound row
      // and synthesizes a deterministic-ish local externalMessageId, but it
      // never publishes a realtime event. Realtime delivery is the caller's
      // exclusive responsibility: the caller knows the correct `senderType`
      // for the widget payload ('user' for human replies, 'ai' for AI
      // auto-replies) and must publish the `new_message` event itself
      // (see `app/api/functions/send-reply` for the human path and
      // `insforge/functions/process-jobs#send_outbound_message` for AI).
      provider = 'webchat';
      providerAccountId = null;
      externalMessageId = `wc_reply_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      deliveryStatus = 'sent';
    }

    const receipt: OutboundDispatchReceipt = {
      channel,
      provider,
      providerAccountId,
      externalMessageId,
      deliveryStatus,
    };

    // 6. Create outbound message record. A provider-accepted SMS/email must
    // never be surfaced as an ordinary retryable failure, or a worker/user can
    // send the same customer-facing message again.
    let message: Message;
    try {
      message = await this.messageRepo.create({
        conversationId: conversation.id,
        senderType: actor.type,
        senderId: actor.id,
        direction: 'outbound',
        channel,
        body,
        subject: channel === 'email' ? (conversation.subject ?? 'Re: Support') : undefined,
        provider,
        providerAccountId,
        externalMessageId,
        deliveryStatus,
      });
    } catch (error) {
      if (externalProviderAccepted) {
        throw new OutboundMessagePostDispatchError({
          originalError: error,
          stage: 'message_persistence',
          dispatchedMessage: null,
          receipt,
        });
      }
      throw error;
    }

    // Once the message row exists, every channel has crossed its retry-safe
    // boundary. Surface later failures with the persisted message attached so
    // callers can finish realtime delivery and report an accepted response.
    try {
      // 7. Update conversation lastMessageAt.
      await this.conversationRepo.update(conversation.id, {
        lastMessageAt: new Date(),
      });
    } catch (error) {
      throw new OutboundMessagePostDispatchError({
        originalError: error,
        stage: 'conversation_update',
        dispatchedMessage: message,
        receipt,
      });
    }

    // 8. Record audit log entry.
    try {
      if (options.writeAuditLog !== false) {
        await this.auditLog.create({
          organizationId: conversation.organizationId,
          actorId: actor.id,
          actorType: actor.type,
          action: 'message_sent',
          resourceType: 'message',
          resourceId: message.id,
          metadata: {
            conversationId: conversation.id,
            channel,
            provider,
          },
        });
      }
    } catch (error) {
      throw new OutboundMessagePostDispatchError({
        originalError: error,
        stage: 'audit_log',
        dispatchedMessage: message,
        receipt,
      });
    }

    // 9. Return the created message.
    return message;
  }
}
