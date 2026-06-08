/**
 * WebchatThreadService — orchestrates webchat thread lifecycle.
 *
 * Responsibilities:
 * - initThread: create contact, conversation (channel='webchat'), and thread
 * - identifyThread: update contact with email/name, set identified_at, rotate visitor token
 * - recordVisitorMessage: delegate to InboundMessageService for webchat messages
 *
 * This service never imports InsForge SDK — all dependencies are injected.
 */

import type { ContactRepository } from '../repositories/contact-repository.js';
import type { ConversationRepository } from '../repositories/conversation-repository.js';
import type { WebchatWidgetRepository } from '../repositories/webchat-widget-repository.js';
import type { WebchatThreadRepository } from '../repositories/webchat-thread-repository.js';
import type { AuditLogRepository } from '../repositories/audit-log-repository.js';
import type {
  Contact,
  Conversation,
  WebchatThread,
  WebchatWidget,
} from '../types/index.js';

export interface InitThreadParams {
  widgetId: string;
  organizationId: string;
  pageUrl?: string | null;
  referrer?: string | null;
  userAgent?: string | null;
  ipCountry?: string | null;
  ipCity?: string | null;
  preChat?: {
    name?: string;
    email?: string;
  };
}

export interface InitThreadResult {
  thread: WebchatThread;
  conversation: Conversation;
  contact: Contact;
  visitorTokenJti: string;
}

export interface IdentifyThreadResult {
  thread: WebchatThread;
  contact: Contact;
  newJti: string;
}

export class WebchatThreadService {
  constructor(
    private contactRepo: ContactRepository,
    private conversationRepo: ConversationRepository,
    private widgetRepo: WebchatWidgetRepository,
    private threadRepo: WebchatThreadRepository,
    private auditLog: AuditLogRepository,
  ) {}

  /**
   * Initialize a new webchat thread.
   * Creates a contact (or finds by email if pre-chat provided), conversation, and thread.
   */
  async initThread(params: InitThreadParams): Promise<InitThreadResult> {
    const { widgetId, organizationId, pageUrl, referrer, userAgent, ipCountry, ipCity, preChat } = params;

    // 1. Find or create contact
    let contact: Contact;
    if (preChat?.email) {
      const existing = await this.contactRepo.findByEmail(organizationId, preChat.email);
      if (existing) {
        contact = existing;
        // Update name if provided and not already set
        if (preChat.name && !existing.name) {
          contact = await this.contactRepo.update(existing.id, { name: preChat.name });
        }
      } else {
        contact = await this.contactRepo.create({
          organizationId,
          email: preChat.email,
          name: preChat.name ?? null,
        });
      }
    } else {
      // Anonymous contact
      contact = await this.contactRepo.create({
        organizationId,
        name: preChat?.name ?? null,
      });
    }

    // 2. Create conversation
    const conversation = await this.conversationRepo.create({
      organizationId,
      contactId: contact.id,
      channel: 'webchat',
      status: 'open',
      aiState: 'idle',
    });

    // 3. Generate visitor token JTI
    const visitorTokenJti = crypto.randomUUID();

    // 4. Create thread
    const thread = await this.threadRepo.create({
      organizationId,
      widgetId,
      conversationId: conversation.id,
      contactId: contact.id,
      visitorTokenJti,
      pageUrl: pageUrl ?? null,
      referrer: referrer ?? null,
      userAgent: userAgent ?? null,
      ipCountry: ipCountry ?? null,
      ipCity: ipCity ?? null,
    });

    // 5. Audit log
    await this.auditLog.create({
      organizationId,
      actorType: 'system',
      action: 'webchat_thread_created',
      resourceType: 'webchat_thread',
      resourceId: thread.id,
      metadata: {
        widgetId,
        conversationId: conversation.id,
        contactId: contact.id,
        identified: !!preChat?.email,
      },
    });

    return { thread, conversation, contact, visitorTokenJti };
  }

  /**
   * Identify a visitor by email/name. Rotates the visitor token JTI.
   */
  async identifyThread(
    threadId: string,
    params: { email: string; name?: string },
  ): Promise<IdentifyThreadResult> {
    const thread = await this.threadRepo.findById(threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    // Update contact with email/name
    const contactUpdates: Partial<Contact> = { email: params.email };
    if (params.name) {
      contactUpdates.name = params.name;
    }
    const contact = await this.contactRepo.update(thread.contactId, contactUpdates);

    // Rotate visitor token JTI (invalidates old JWT)
    const newJti = crypto.randomUUID();
    const updatedThread = await this.threadRepo.update(threadId, {
      visitorTokenJti: newJti,
      identifiedAt: new Date(),
    });

    // Audit log
    await this.auditLog.create({
      organizationId: thread.organizationId,
      actorType: 'system',
      action: 'webchat_thread_identified',
      resourceType: 'webchat_thread',
      resourceId: thread.id,
      metadata: { email: params.email },
    });

    return { thread: updatedThread, contact, newJti };
  }
}
