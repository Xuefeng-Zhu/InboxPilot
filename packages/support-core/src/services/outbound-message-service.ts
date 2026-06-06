/**
 * OutboundMessageService — orchestrates sending outbound replies over SMS or email.
 *
 * sendReply flow:
 * 1. Load conversation by ID
 * 2. Determine channel from conversation (sms or email)
 * 3. Load the contact to get the recipient address (phone or email)
 * 4. If SMS: find default phone number, get SMS adapter, call sendSms
 * 5. If email: find default email address, get email adapter, call sendEmail
 * 6. Create outbound message record with provider, providerAccountId, externalMessageId
 * 7. Update conversation lastMessageAt
 * 8. Record audit log entry for 'message_sent'
 * 9. Return the created message
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
   * @param userId - The user sending the reply
   * @returns The created outbound Message
   */
  async sendReply(conversationId: string, body: string, userId: string): Promise<Message> {
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
    let providerAccountId: string;
    let externalMessageId: string;
    let deliveryStatus: 'queued' | 'sent';

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
        providerConfig: {},
      });

      provider = sendResult.provider;
      providerAccountId = smsAccount.id;
      externalMessageId = sendResult.externalMessageId;
      deliveryStatus = sendResult.status;
    } else {
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
        providerConfig: {},
      });

      provider = sendResult.provider;
      providerAccountId = emailAccount.id;
      externalMessageId = sendResult.externalMessageId;
      deliveryStatus = sendResult.status;
    }

    // 6. Create outbound message record
    const message = await this.messageRepo.create({
      conversationId: conversation.id,
      senderType: 'user',
      senderId: userId,
      direction: 'outbound',
      channel,
      body,
      subject: channel === 'email' ? (conversation.subject ?? 'Re: Support') : undefined,
      provider,
      providerAccountId,
      externalMessageId,
      deliveryStatus,
    });

    // 7. Update conversation lastMessageAt
    await this.conversationRepo.update(conversation.id, {
      lastMessageAt: new Date(),
    });

    // 8. Record audit log entry
    await this.auditLog.create({
      organizationId: conversation.organizationId,
      actorId: userId,
      actorType: 'user',
      action: 'message_sent',
      resourceType: 'message',
      resourceId: message.id,
      metadata: {
        conversationId: conversation.id,
        channel,
        provider,
      },
    });

    // 9. Return the created message
    return message;
  }
}
