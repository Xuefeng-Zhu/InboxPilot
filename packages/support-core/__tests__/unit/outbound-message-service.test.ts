import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OutboundMessageService } from '../../src/services/outbound-message-service.js';
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
      const result = await service.sendReply('conv-sms-001', 'We can help you with that!', USER_ID);

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
      const result = await service.sendReply('conv-email-001', 'We can help you with that!', USER_ID);

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

      await service.sendReply('conv-email-001', 'Reply body', USER_ID);

      expect(emailAdapter.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Re: Support',
        }),
      );
    });
  });

  describe('sendReply — error cases', () => {
    it('throws when conversation is not found', async () => {
      vi.mocked(conversationRepo.findById).mockResolvedValue(null);

      await expect(
        service.sendReply('nonexistent', 'body', USER_ID),
      ).rejects.toThrow('Conversation not found: nonexistent');
    });

    it('throws when contact is not found', async () => {
      vi.mocked(contactRepo.findById).mockResolvedValue(null);

      await expect(
        service.sendReply('conv-sms-001', 'body', USER_ID),
      ).rejects.toThrow('Contact not found: contact-001');
    });

    it('throws when no default SMS phone number is configured', async () => {
      vi.mocked(smsAccountRepo.findDefaultPhoneNumber).mockResolvedValue(null);

      await expect(
        service.sendReply('conv-sms-001', 'body', USER_ID),
      ).rejects.toThrow('No default SMS phone number configured');
    });

    it('throws when SMS provider account is not found', async () => {
      vi.mocked(smsAccountRepo.findById).mockResolvedValue(null);

      await expect(
        service.sendReply('conv-sms-001', 'body', USER_ID),
      ).rejects.toThrow('SMS provider account not found');
    });

    it('throws when contact has no phone number for SMS reply', async () => {
      const noPhoneContact = { ...SMS_CONTACT, phone: null };
      vi.mocked(contactRepo.findById).mockResolvedValue(noPhoneContact);

      await expect(
        service.sendReply('conv-sms-001', 'body', USER_ID),
      ).rejects.toThrow('has no phone number for SMS reply');
    });

    it('throws when no default email address is configured', async () => {
      vi.mocked(conversationRepo.findById).mockResolvedValue(EMAIL_CONVERSATION);
      vi.mocked(contactRepo.findById).mockResolvedValue(EMAIL_CONTACT);
      vi.mocked(emailAccountRepo.findDefaultEmailAddress).mockResolvedValue(null);

      await expect(
        service.sendReply('conv-email-001', 'body', USER_ID),
      ).rejects.toThrow('No default email address configured');
    });

    it('throws when email provider account is not found', async () => {
      vi.mocked(conversationRepo.findById).mockResolvedValue(EMAIL_CONVERSATION);
      vi.mocked(contactRepo.findById).mockResolvedValue(EMAIL_CONTACT);
      vi.mocked(emailAccountRepo.findById).mockResolvedValue(null);

      await expect(
        service.sendReply('conv-email-001', 'body', USER_ID),
      ).rejects.toThrow('Email provider account not found');
    });

    it('throws when contact has no email address for email reply', async () => {
      vi.mocked(conversationRepo.findById).mockResolvedValue(EMAIL_CONVERSATION);
      const noEmailContact = { ...EMAIL_CONTACT, email: null };
      vi.mocked(contactRepo.findById).mockResolvedValue(noEmailContact);

      await expect(
        service.sendReply('conv-email-001', 'body', USER_ID),
      ).rejects.toThrow('has no email address for email reply');
    });
  });
});
