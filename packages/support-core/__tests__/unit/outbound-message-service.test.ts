import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  OutboundMessagePostDispatchError,
  OutboundMessageService,
} from '../../src/services/outbound-message-service.js';
import type { ConversationRepository } from '../../src/repositories/conversation-repository.js';
import type { ContactRepository } from '../../src/repositories/contact-repository.js';
import type { MessageRepository } from '../../src/repositories/message-repository.js';
import type { AuditLogRepository } from '../../src/repositories/audit-log-repository.js';
import type { SmsProviderAccountRepository } from '../../src/repositories/sms-provider-account-repository.js';
import type { EmailProviderAccountRepository } from '../../src/repositories/email-provider-account-repository.js';
import type { ProviderRegistry } from '../../src/interfaces/provider-registry.js';
import type { SmsProviderAdapter } from '../../src/interfaces/sms-provider-adapter.js';
import type { EmailProviderAdapter } from '../../src/interfaces/email-provider-adapter.js';
import type {
  Contact,
  Conversation,
  Message,
  AuditLog,
  SmsPhoneNumber,
  SmsProviderAccount,
  EmailAddress,
  EmailProviderAccount,
} from '../../src/types/index.js';

/**
 * Unit tests for OutboundMessageService.
 *
 * All repository, adapter, and registry dependencies are mocked
 * to test the orchestration logic in isolation.
 */

// ─── Fixtures ─────────────────────────────────────────────────────

const ORG_ID = 'org-001';
const USER_ID = 'user-001';
const USER_ACTOR = { type: 'user', id: USER_ID } as const;

const SMS_CONVERSATION: Conversation = {
  id: 'conv-sms-001',
  organizationId: ORG_ID,
  contactId: 'contact-001',
  channel: 'sms',
  status: 'open',
  aiState: 'idle',
  subject: null,
  assignedTo: null,
  lastMessageAt: null,
  metadata: {},
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const EMAIL_CONVERSATION: Conversation = {
  id: 'conv-email-001',
  organizationId: ORG_ID,
  contactId: 'contact-002',
  channel: 'email',
  status: 'open',
  aiState: 'idle',
  subject: 'Help with my order',
  assignedTo: null,
  lastMessageAt: null,
  metadata: {},
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const WEBCHAT_CONVERSATION: Conversation = {
  id: 'conv-webchat-001',
  organizationId: ORG_ID,
  contactId: 'contact-003',
  channel: 'webchat',
  status: 'open',
  aiState: 'idle',
  subject: null,
  assignedTo: null,
  lastMessageAt: null,
  metadata: {},
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const SMS_CONTACT: Contact = {
  id: 'contact-001',
  organizationId: ORG_ID,
  name: 'John Doe',
  email: null,
  phone: '+15551234567',
  metadata: {},
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const EMAIL_CONTACT: Contact = {
  id: 'contact-002',
  organizationId: ORG_ID,
  name: 'Jane Doe',
  email: 'jane@example.com',
  phone: null,
  metadata: {},
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const WEBCHAT_CONTACT: Contact = {
  id: 'contact-003',
  organizationId: ORG_ID,
  name: 'Web Visitor',
  email: null,
  phone: null,
  metadata: {},
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const DEFAULT_PHONE: SmsPhoneNumber = {
  id: 'phone-001',
  providerAccountId: 'sms-acct-001',
  organizationId: ORG_ID,
  phoneNumber: '+15559876543',
  isDefault: true,
  createdAt: new Date('2024-01-01'),
};

const SMS_ACCOUNT: SmsProviderAccount = {
  id: 'sms-acct-001',
  organizationId: ORG_ID,
  provider: 'mock',
  label: 'Mock SMS',
  credentialsSecretId: 'secret-001',
  isActive: true,
  metadata: {},
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const DEFAULT_EMAIL: EmailAddress = {
  id: 'email-addr-001',
  providerAccountId: 'email-acct-001',
  organizationId: ORG_ID,
  emailAddress: 'support@company.com',
  isDefault: true,
  createdAt: new Date('2024-01-01'),
};

const EMAIL_ACCOUNT: EmailProviderAccount = {
  id: 'email-acct-001',
  organizationId: ORG_ID,
  provider: 'mock',
  label: 'Mock Email',
  credentialsSecretId: 'secret-002',
  isActive: true,
  metadata: {},
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const OUTBOUND_SMS_MESSAGE: Message = {
  id: 'msg-out-001',
  conversationId: 'conv-sms-001',
  senderType: 'user',
  senderId: USER_ID,
  direction: 'outbound',
  channel: 'sms',
  body: 'We can help you with that!',
  subject: null,
  rawPayload: {},
  provider: 'mock',
  providerAccountId: 'sms-acct-001',
  externalMessageId: 'mock_sms_1',
  deliveryStatus: 'queued',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const OUTBOUND_EMAIL_MESSAGE: Message = {
  id: 'msg-out-002',
  conversationId: 'conv-email-001',
  senderType: 'user',
  senderId: USER_ID,
  direction: 'outbound',
  channel: 'email',
  body: 'We can help you with that!',
  subject: 'Help with my order',
  rawPayload: {},
  provider: 'mock',
  providerAccountId: 'email-acct-001',
  externalMessageId: 'mock_email_1',
  deliveryStatus: 'queued',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const OUTBOUND_WEBCHAT_MESSAGE: Message = {
  id: 'msg-out-003',
  conversationId: 'conv-webchat-001',
  senderType: 'user',
  senderId: USER_ID,
  direction: 'outbound',
  channel: 'webchat',
  body: 'We can help you with that!',
  subject: null,
  rawPayload: {},
  provider: 'webchat',
  providerAccountId: null,
  externalMessageId: 'wc_reply_placeholder',
  deliveryStatus: 'sent',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const SAMPLE_AUDIT_LOG: AuditLog = {
  id: 'audit-001',
  organizationId: ORG_ID,
  actorId: USER_ID,
  actorType: 'user',
  action: 'message_sent',
  resourceType: 'message',
  resourceId: 'msg-out-001',
  metadata: {},
  createdAt: new Date(),
};

// ─── Mock Factories ───────────────────────────────────────────────

function createMockConversationRepo(): ConversationRepository {
  return {
    findById: vi.fn().mockResolvedValue(SMS_CONVERSATION),
    findOpenByContactAndChannel: vi.fn(),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue(SMS_CONVERSATION),
    listByOrg: vi.fn(),
  } as unknown as ConversationRepository;
}

function createMockContactRepo(): ContactRepository {
  return {
    findById: vi.fn().mockResolvedValue(SMS_CONTACT),
    findByPhone: vi.fn(),
    findByEmail: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  } as unknown as ContactRepository;
}

function createMockMessageRepo(): MessageRepository {
  return {
    findByExternalId: vi.fn(),
    create: vi.fn().mockResolvedValue(OUTBOUND_SMS_MESSAGE),
    listByConversation: vi.fn(),
  } as unknown as MessageRepository;
}

function createMockSmsAccountRepo(): SmsProviderAccountRepository {
  return {
    findDefaultPhoneNumber: vi.fn().mockResolvedValue(DEFAULT_PHONE),
    findById: vi.fn().mockResolvedValue(SMS_ACCOUNT),
    findByOrg: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } as unknown as SmsProviderAccountRepository;
}

function createMockEmailAccountRepo(): EmailProviderAccountRepository {
  return {
    findDefaultEmailAddress: vi.fn().mockResolvedValue(DEFAULT_EMAIL),
    findById: vi.fn().mockResolvedValue(EMAIL_ACCOUNT),
    findByOrg: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } as unknown as EmailProviderAccountRepository;
}

function createMockSmsAdapter(): SmsProviderAdapter {
  return {
    providerId: 'mock',
    sendSms: vi.fn().mockResolvedValue({
      externalMessageId: 'mock_sms_1',
      provider: 'mock',
      status: 'queued',
    }),
    parseInboundWebhook: vi.fn(),
    parseStatusWebhook: vi.fn(),
    verifyWebhook: vi.fn(),
  };
}

function createMockEmailAdapter(): EmailProviderAdapter {
  return {
    providerId: 'mock',
    sendEmail: vi.fn().mockResolvedValue({
      externalMessageId: 'mock_email_1',
      provider: 'mock',
      status: 'queued',
    }),
    parseInboundWebhook: vi.fn(),
    parseStatusWebhook: vi.fn(),
    verifyWebhook: vi.fn(),
  };
}

function createMockProviderRegistry(
  smsAdapter: SmsProviderAdapter,
  emailAdapter: EmailProviderAdapter,
): ProviderRegistry {
  return {
    getSmsAdapter: vi.fn().mockReturnValue(smsAdapter),
    getEmailAdapter: vi.fn().mockReturnValue(emailAdapter),
    registerSmsAdapter: vi.fn(),
    registerEmailAdapter: vi.fn(),
  } as unknown as ProviderRegistry;
}

function createMockAuditLog(): AuditLogRepository {
  return {
    create: vi.fn().mockResolvedValue(SAMPLE_AUDIT_LOG),
  } as unknown as AuditLogRepository;
}

// ─── Tests ────────────────────────────────────────────────────────

describe('OutboundMessageService', () => {
  let conversationRepo: ReturnType<typeof createMockConversationRepo>;
  let contactRepo: ReturnType<typeof createMockContactRepo>;
  let messageRepo: ReturnType<typeof createMockMessageRepo>;
  let smsAccountRepo: ReturnType<typeof createMockSmsAccountRepo>;
  let emailAccountRepo: ReturnType<typeof createMockEmailAccountRepo>;
  let smsAdapter: ReturnType<typeof createMockSmsAdapter>;
  let emailAdapter: ReturnType<typeof createMockEmailAdapter>;
  let providerRegistry: ReturnType<typeof createMockProviderRegistry>;
  let auditLog: ReturnType<typeof createMockAuditLog>;
  let service: OutboundMessageService;

  beforeEach(() => {
    conversationRepo = createMockConversationRepo();
    contactRepo = createMockContactRepo();
    messageRepo = createMockMessageRepo();
    smsAccountRepo = createMockSmsAccountRepo();
    emailAccountRepo = createMockEmailAccountRepo();
    smsAdapter = createMockSmsAdapter();
    emailAdapter = createMockEmailAdapter();
    providerRegistry = createMockProviderRegistry(smsAdapter, emailAdapter);
    auditLog = createMockAuditLog();
    service = new OutboundMessageService(
      conversationRepo,
      contactRepo,
      messageRepo,
      providerRegistry,
      smsAccountRepo,
      emailAccountRepo,
      auditLog,
    );
  });

  describe('sendReply — SMS channel', () => {
    it('sends an SMS reply through the full flow', async () => {
      const result = await service.sendReply('conv-sms-001', 'We can help you with that!', USER_ACTOR);

      // 1. Load conversation
      expect(conversationRepo.findById).toHaveBeenCalledWith('conv-sms-001');

      // 2. Load contact
      expect(contactRepo.findById).toHaveBeenCalledWith('contact-001');

      // 3. Find default phone number
      expect(smsAccountRepo.findDefaultPhoneNumber).toHaveBeenCalledWith(ORG_ID);

      // 4. Look up SMS provider account
      expect(smsAccountRepo.findById).toHaveBeenCalledWith('sms-acct-001');

      // 5. Get SMS adapter from registry
      expect(providerRegistry.getSmsAdapter).toHaveBeenCalledWith('mock');

      // 6. Send SMS via adapter
      expect(smsAdapter.sendSms).toHaveBeenCalledWith({
        to: '+15551234567',
        from: '+15559876543',
        body: 'We can help you with that!',
        providerConfig: {},
      });

      // 7. Create outbound message
      expect(messageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-sms-001',
          senderType: 'user',
          senderId: USER_ID,
          direction: 'outbound',
          channel: 'sms',
          body: 'We can help you with that!',
          provider: 'mock',
          providerAccountId: 'sms-acct-001',
          externalMessageId: 'mock_sms_1',
          deliveryStatus: 'queued',
        }),
      );

      // 8. Update conversation lastMessageAt
      expect(conversationRepo.update).toHaveBeenCalledWith('conv-sms-001', {
        lastMessageAt: expect.any(Date),
      });

      // 9. Audit log
      expect(auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG_ID,
          actorId: USER_ID,
          actorType: 'user',
          action: 'message_sent',
          resourceType: 'message',
          resourceId: 'msg-out-001',
          metadata: expect.objectContaining({
            conversationId: 'conv-sms-001',
            channel: 'sms',
            provider: 'mock',
          }),
        }),
      );

      // 10. Returns the created message
      expect(result.id).toBe('msg-out-001');
      expect(result.direction).toBe('outbound');
    });
  });

  describe('sendReply — email channel', () => {
    beforeEach(() => {
      vi.mocked(conversationRepo.findById).mockResolvedValue(EMAIL_CONVERSATION);
      vi.mocked(contactRepo.findById).mockResolvedValue(EMAIL_CONTACT);
      vi.mocked(messageRepo.create).mockResolvedValue(OUTBOUND_EMAIL_MESSAGE);
    });

    it('sends an email reply through the full flow', async () => {
      const result = await service.sendReply('conv-email-001', 'We can help you with that!', USER_ACTOR);

      // 1. Load conversation
      expect(conversationRepo.findById).toHaveBeenCalledWith('conv-email-001');

      // 2. Load contact
      expect(contactRepo.findById).toHaveBeenCalledWith('contact-002');

      // 3. Find default email address
      expect(emailAccountRepo.findDefaultEmailAddress).toHaveBeenCalledWith(ORG_ID);

      // 4. Look up email provider account
      expect(emailAccountRepo.findById).toHaveBeenCalledWith('email-acct-001');

      // 5. Get email adapter from registry
      expect(providerRegistry.getEmailAdapter).toHaveBeenCalledWith('mock');

      // 6. Send email via adapter
      expect(emailAdapter.sendEmail).toHaveBeenCalledWith({
        to: 'jane@example.com',
        from: 'support@company.com',
        subject: 'Help with my order',
        bodyText: 'We can help you with that!',
        providerConfig: {},
      });

      // 7. Create outbound message with email fields
      expect(messageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-email-001',
          senderType: 'user',
          senderId: USER_ID,
          direction: 'outbound',
          channel: 'email',
          body: 'We can help you with that!',
          subject: 'Help with my order',
          provider: 'mock',
          providerAccountId: 'email-acct-001',
          externalMessageId: 'mock_email_1',
          deliveryStatus: 'queued',
        }),
      );

      // 8. Audit log with email channel
      expect(auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            channel: 'email',
            provider: 'mock',
          }),
        }),
      );

      expect(result.id).toBe('msg-out-002');
      expect(result.channel).toBe('email');
    });

    it('uses fallback subject when conversation has no subject', async () => {
      const noSubjectConv = { ...EMAIL_CONVERSATION, subject: null };
      vi.mocked(conversationRepo.findById).mockResolvedValue(noSubjectConv);

      await service.sendReply('conv-email-001', 'Reply body', USER_ACTOR);

      expect(emailAdapter.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Re: Support',
        }),
      );
    });
  });

  describe('sendReply — providerConfig forwarding', () => {
    // Provider credentials are security-sensitive (Twilio authToken,
    // Postmark serverToken, Telnyx apiKey). The route loads them from
    // InsForge secrets and forwards them via `providerConfig`; if the
    // service ever silently dropped them, the adapter would fall back to
    // its constructor-injected credentials (none today) and the send
    // would fail or use a stale credential. These tests lock the wiring.

    it('forwards a non-empty providerConfig to the SMS adapter', async () => {
      const providerConfig = { accountSid: 'AC_test_sid', authToken: 'twilio_secret' };

      await service.sendReply('conv-sms-001', 'Body', USER_ACTOR, providerConfig);

      expect(smsAdapter.sendSms).toHaveBeenCalledWith(
        expect.objectContaining({ providerConfig }),
      );
    });

    it('forwards a non-empty providerConfig to the email adapter', async () => {
      const providerConfig = { serverToken: 'postmark_secret' };
      vi.mocked(conversationRepo.findById).mockResolvedValue(EMAIL_CONVERSATION);
      vi.mocked(contactRepo.findById).mockResolvedValue(EMAIL_CONTACT);

      await service.sendReply('conv-email-001', 'Body', USER_ACTOR, providerConfig);

      expect(emailAdapter.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ providerConfig }),
      );
    });

    it('defaults providerConfig to an empty object when omitted', async () => {
      // Three-arg call shape is the historical default and is used by
      // any caller that has not been updated to pass credentials.
      await service.sendReply('conv-sms-001', 'Body', USER_ACTOR);

      expect(smsAdapter.sendSms).toHaveBeenCalledWith(
        expect.objectContaining({ providerConfig: {} }),
      );
    });
  });

  describe('sendReply — writeAuditLog option', () => {
    it('writes the audit log by default', async () => {
      await service.sendReply('conv-sms-001', 'Body', USER_ACTOR);

      expect(auditLog.create).toHaveBeenCalledTimes(1);
    });

    it('skips the audit log when writeAuditLog is false', async () => {
      // The AI auto-reply path in process-jobs#send_outbound_message
      // passes writeAuditLog: false so it can write a single specialized
      // audit row with auto-reply metadata.
      await service.sendReply('conv-sms-001', 'Body', USER_ACTOR, {}, { writeAuditLog: false });

      expect(auditLog.create).not.toHaveBeenCalled();
    });

    it('persists a typed AI actor without coercing a null sender ID', async () => {
      await service.sendReply(
        'conv-sms-001',
        'AI reply',
        { type: 'ai', id: null },
      );

      expect(messageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ senderType: 'ai', senderId: null }),
      );
      expect(auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ actorType: 'ai', actorId: null }),
      );
    });
  });

  describe('sendReply — error cases', () => {
    it('throws when conversation is not found', async () => {
      vi.mocked(conversationRepo.findById).mockResolvedValue(null);

      await expect(
        service.sendReply('nonexistent', 'body', USER_ACTOR),
      ).rejects.toThrow('Conversation not found: nonexistent');
    });

    it('throws when contact is not found', async () => {
      vi.mocked(contactRepo.findById).mockResolvedValue(null);

      await expect(
        service.sendReply('conv-sms-001', 'body', USER_ACTOR),
      ).rejects.toThrow('Contact not found: contact-001');
    });

    it('throws when no default SMS phone number is configured', async () => {
      vi.mocked(smsAccountRepo.findDefaultPhoneNumber).mockResolvedValue(null);

      await expect(
        service.sendReply('conv-sms-001', 'body', USER_ACTOR),
      ).rejects.toThrow('No default SMS phone number configured');
    });

    it('throws when SMS provider account is not found', async () => {
      vi.mocked(smsAccountRepo.findById).mockResolvedValue(null);

      await expect(
        service.sendReply('conv-sms-001', 'body', USER_ACTOR),
      ).rejects.toThrow('SMS provider account not found');
    });

    it('throws when contact has no phone number for SMS reply', async () => {
      const noPhoneContact = { ...SMS_CONTACT, phone: null };
      vi.mocked(contactRepo.findById).mockResolvedValue(noPhoneContact);

      await expect(
        service.sendReply('conv-sms-001', 'body', USER_ACTOR),
      ).rejects.toThrow('has no phone number for SMS reply');
    });

    it('throws when no default email address is configured', async () => {
      vi.mocked(conversationRepo.findById).mockResolvedValue(EMAIL_CONVERSATION);
      vi.mocked(contactRepo.findById).mockResolvedValue(EMAIL_CONTACT);
      vi.mocked(emailAccountRepo.findDefaultEmailAddress).mockResolvedValue(null);

      await expect(
        service.sendReply('conv-email-001', 'body', USER_ACTOR),
      ).rejects.toThrow('No default email address configured');
    });

    it('throws when email provider account is not found', async () => {
      vi.mocked(conversationRepo.findById).mockResolvedValue(EMAIL_CONVERSATION);
      vi.mocked(contactRepo.findById).mockResolvedValue(EMAIL_CONTACT);
      vi.mocked(emailAccountRepo.findById).mockResolvedValue(null);

      await expect(
        service.sendReply('conv-email-001', 'body', USER_ACTOR),
      ).rejects.toThrow('Email provider account not found');
    });

    it('throws when contact has no email address for email reply', async () => {
      vi.mocked(conversationRepo.findById).mockResolvedValue(EMAIL_CONVERSATION);
      const noEmailContact = { ...EMAIL_CONTACT, email: null };
      vi.mocked(contactRepo.findById).mockResolvedValue(noEmailContact);

      await expect(
        service.sendReply('conv-email-001', 'body', USER_ACTOR),
      ).rejects.toThrow('has no email address for email reply');
    });

    it('marks persistence failures after an SMS provider accepts the message', async () => {
      vi.mocked(messageRepo.create).mockRejectedValue(new Error('database unavailable'));

      const result = service.sendReply('conv-sms-001', 'body', USER_ACTOR);

      await expect(result).rejects.toBeInstanceOf(OutboundMessagePostDispatchError);
      await expect(result).rejects.toThrow(
        'Message delivery reached message_persistence before local finalization failed: database unavailable',
      );
      expect(smsAdapter.sendSms).toHaveBeenCalledTimes(1);

      try {
        await result;
      } catch (error) {
        expect(error).toMatchObject({
          stage: 'message_persistence',
          dispatchedMessage: null,
          receipt: {
            channel: 'sms',
            provider: 'mock',
            providerAccountId: 'sms-acct-001',
            externalMessageId: 'mock_sms_1',
            deliveryStatus: 'queued',
          },
        });
      }
    });

    it('attaches the persisted message when conversation finalization fails', async () => {
      vi.mocked(conversationRepo.update).mockRejectedValue(new Error('conversation write failed'));

      const result = service.sendReply('conv-sms-001', 'body', USER_ACTOR);

      await expect(result).rejects.toMatchObject({
        name: 'OutboundMessagePostDispatchError',
        stage: 'conversation_update',
        dispatchedMessage: OUTBOUND_SMS_MESSAGE,
      });
      expect(messageRepo.create).toHaveBeenCalledTimes(1);
      expect(auditLog.create).not.toHaveBeenCalled();
    });

    it('attaches the persisted message when audit finalization fails', async () => {
      vi.mocked(auditLog.create).mockRejectedValue(new Error('audit write failed'));

      const result = service.sendReply('conv-sms-001', 'body', USER_ACTOR);

      await expect(result).rejects.toMatchObject({
        name: 'OutboundMessagePostDispatchError',
        stage: 'audit_log',
        dispatchedMessage: OUTBOUND_SMS_MESSAGE,
      });
      expect(messageRepo.create).toHaveBeenCalledTimes(1);
      expect(conversationRepo.update).toHaveBeenCalledTimes(1);
    });

    it('keeps webchat persistence failures retryable because no provider was called', async () => {
      vi.mocked(conversationRepo.findById).mockResolvedValue(WEBCHAT_CONVERSATION);
      vi.mocked(contactRepo.findById).mockResolvedValue(WEBCHAT_CONTACT);
      const persistenceError = new Error('database unavailable');
      vi.mocked(messageRepo.create).mockRejectedValue(persistenceError);

      const result = service.sendReply('conv-webchat-001', 'body', USER_ACTOR);

      await expect(result).rejects.toBe(persistenceError);
      await expect(result).rejects.not.toBeInstanceOf(OutboundMessagePostDispatchError);
    });

    it('marks webchat cleanup failures non-retryable after the message row exists', async () => {
      vi.mocked(conversationRepo.findById).mockResolvedValue(WEBCHAT_CONVERSATION);
      vi.mocked(contactRepo.findById).mockResolvedValue(WEBCHAT_CONTACT);
      vi.mocked(messageRepo.create).mockResolvedValue(OUTBOUND_WEBCHAT_MESSAGE);
      vi.mocked(conversationRepo.update).mockRejectedValue(new Error('conversation write failed'));

      const result = service.sendReply('conv-webchat-001', 'body', USER_ACTOR);

      await expect(result).rejects.toMatchObject({
        name: 'OutboundMessagePostDispatchError',
        stage: 'conversation_update',
        dispatchedMessage: OUTBOUND_WEBCHAT_MESSAGE,
        receipt: expect.objectContaining({ channel: 'webchat' }),
      });
    });
  });

  describe('sendReply — webchat channel', () => {
    // Webchat replies have no external provider — the service synthesizes
    // provider-stub fields and persists the message row. Realtime delivery
    // is the caller's responsibility (the route publishes `new_message`
    // with the correct `senderType`: 'user' for human, 'ai' for AI
    // auto-reply). These tests lock the in-service behavior so that
    // dropping the realtime publish from the service does not regress.

    beforeEach(() => {
      vi.mocked(conversationRepo.findById).mockResolvedValue(WEBCHAT_CONVERSATION);
      vi.mocked(contactRepo.findById).mockResolvedValue(WEBCHAT_CONTACT);
      vi.mocked(messageRepo.create).mockResolvedValue(OUTBOUND_WEBCHAT_MESSAGE);
    });

    it('persists the outbound row with webchat provider-stub fields', async () => {
      const result = await service.sendReply(
        'conv-webchat-001',
        'We can help you with that!',
        USER_ACTOR,
      );

      // 1. No adapter was touched (no SMS, no email path)
      expect(providerRegistry.getSmsAdapter).not.toHaveBeenCalled();
      expect(providerRegistry.getEmailAdapter).not.toHaveBeenCalled();
      expect(smsAdapter.sendSms).not.toHaveBeenCalled();
      expect(emailAdapter.sendEmail).not.toHaveBeenCalled();

      // 2. messageRepo.create received the correct webchat payload
      expect(messageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-webchat-001',
          senderType: 'user',
          senderId: USER_ID,
          direction: 'outbound',
          channel: 'webchat',
          body: 'We can help you with that!',
          provider: 'webchat',
          providerAccountId: null,
          deliveryStatus: 'sent',
          externalMessageId: expect.stringMatching(/^wc_reply_/),
        }),
      );

      // 3. Conversation was bumped
      expect(conversationRepo.update).toHaveBeenCalledWith('conv-webchat-001', {
        lastMessageAt: expect.any(Date),
      });

      // 4. Audit log was written
      expect(auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: 'user',
          action: 'message_sent',
        }),
      );

      expect(result.id).toBe('msg-out-003');
      expect(result.channel).toBe('webchat');
    });

    it('generates a unique externalMessageId for each call', async () => {
      await service.sendReply('conv-webchat-001', 'First reply', USER_ACTOR);
      await service.sendReply('conv-webchat-001', 'Second reply', USER_ACTOR);

      expect(messageRepo.create).toHaveBeenCalledTimes(2);
      const firstId = vi.mocked(messageRepo.create).mock.calls[0][0].externalMessageId;
      const secondId = vi.mocked(messageRepo.create).mock.calls[1][0].externalMessageId;
      expect(firstId).toMatch(/^wc_reply_/);
      expect(secondId).toMatch(/^wc_reply_/);
      expect(firstId).not.toBe(secondId);
    });
  });
});
