import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InboundMessageService } from '../../src/services/inbound-message-service.js';
import type { ContactRepository } from '../../src/repositories/contact-repository.js';
import type { ConversationRepository } from '../../src/repositories/conversation-repository.js';
import type { MessageRepository } from '../../src/repositories/message-repository.js';
import type { AuditLogRepository } from '../../src/repositories/audit-log-repository.js';
import type { JobQueue } from '../../src/interfaces/job-queue.js';
import type {
  Contact,
  Conversation,
  Message,
  Job,
  NormalizedInboundSms,
  NormalizedInboundEmail,
} from '../../src/types/index.js';

/**
 * Unit tests for InboundMessageService.
 *
 * All repository and job queue dependencies are mocked to test
 * the orchestration logic in isolation.
 */

// ─── Fixtures ─────────────────────────────────────────────────────

const ORG_ID = 'org-001';

const SAMPLE_CONTACT: Contact = {
  id: 'contact-001',
  organizationId: ORG_ID,
  name: null,
  email: null,
  phone: '+15551234567',
  metadata: {},
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const SAMPLE_CONVERSATION: Conversation = {
  id: 'conv-001',
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

const SAMPLE_MESSAGE: Message = {
  id: 'msg-001',
  conversationId: 'conv-001',
  senderType: 'contact',
  senderId: null,
  direction: 'inbound',
  channel: 'sms',
  body: 'Hello, I need help',
  subject: null,
  rawPayload: {},
  provider: 'mock',
  providerAccountId: null,
  externalMessageId: 'ext-msg-001',
  deliveryStatus: 'delivered',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const SAMPLE_JOB: Job = {
  id: 'job-001',
  organizationId: ORG_ID,
  jobType: 'process_ai_message',
  payload: {},
  status: 'pending',
  attempts: 0,
  maxAttempts: 5,
  lastError: null,
  runAfter: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
  completedAt: null,
};

// ─── Mock Factories ───────────────────────────────────────────────

function createMockContactRepo(): ContactRepository {
  return {
    findByPhone: vi.fn().mockResolvedValue(null),
    findByEmail: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(SAMPLE_CONTACT),
    update: vi.fn(),
  } as unknown as ContactRepository;
}

function createMockConversationRepo(): ConversationRepository {
  return {
    findById: vi.fn().mockResolvedValue(SAMPLE_CONVERSATION),
    findOpenByContactAndChannel: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(SAMPLE_CONVERSATION),
    update: vi.fn().mockResolvedValue(SAMPLE_CONVERSATION),
    listByOrg: vi.fn(),
  } as unknown as ConversationRepository;
}

function createMockMessageRepo(): MessageRepository {
  return {
    findByExternalId: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(SAMPLE_MESSAGE),
    listByConversation: vi.fn(),
  } as unknown as MessageRepository;
}

function createMockJobQueue(): JobQueue {
  return {
    enqueue: vi.fn().mockResolvedValue(SAMPLE_JOB),
    claim: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
  };
}

function createMockAuditLog(): AuditLogRepository {
  return {
    ensureMessageReceived: vi.fn().mockResolvedValue(undefined),
  } as unknown as AuditLogRepository;
}

// ─── Tests ────────────────────────────────────────────────────────

describe('InboundMessageService', () => {
  let contactRepo: ReturnType<typeof createMockContactRepo>;
  let conversationRepo: ReturnType<typeof createMockConversationRepo>;
  let messageRepo: ReturnType<typeof createMockMessageRepo>;
  let jobQueue: ReturnType<typeof createMockJobQueue>;
  let auditLog: ReturnType<typeof createMockAuditLog>;
  let service: InboundMessageService;

  beforeEach(() => {
    contactRepo = createMockContactRepo();
    conversationRepo = createMockConversationRepo();
    messageRepo = createMockMessageRepo();
    jobQueue = createMockJobQueue();
    auditLog = createMockAuditLog();
    service = new InboundMessageService(
      contactRepo,
      conversationRepo,
      messageRepo,
      jobQueue,
      auditLog,
    );
  });

  describe('processInboundSms', () => {
    const smsPayload: NormalizedInboundSms = {
      from: '+15551234567',
      to: '+15559876543',
      body: 'Hello, I need help',
      externalMessageId: 'ext-msg-001',
      rawPayload: { original: true },
    };

    it('processes a new SMS message through the full flow', async () => {
      const result = await service.processInboundSms(smsPayload, ORG_ID, 'mock');

      // 1. Duplicate check
      expect(messageRepo.findByExternalId).toHaveBeenCalledWith('mock', 'ext-msg-001');

      // 2+3. Contact lookup by phone
      expect(contactRepo.findByPhone).toHaveBeenCalledWith(ORG_ID, '+15551234567');
      expect(contactRepo.create).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        phone: '+15551234567',
      });

      // 4. Conversation lookup
      expect(conversationRepo.findOpenByContactAndChannel).toHaveBeenCalledWith(
        'contact-001',
        'sms',
      );
      expect(conversationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG_ID,
          contactId: 'contact-001',
          channel: 'sms',
          status: 'open',
          aiState: 'idle',
        }),
      );

      // 5. Message creation
      expect(messageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-001',
          senderType: 'contact',
          direction: 'inbound',
          channel: 'sms',
          body: 'Hello, I need help',
          rawPayload: { original: true },
          provider: 'mock',
          externalMessageId: 'ext-msg-001',
          deliveryStatus: 'delivered',
        }),
      );

      // 6. Conversation lastMessageAt update
      expect(conversationRepo.update).toHaveBeenCalledWith('conv-001', {
        lastMessageAt: expect.any(Date),
      });

      // 7. Job enqueue
      expect(jobQueue.enqueue).toHaveBeenCalledWith(
        'process_ai_message',
        { conversationId: 'conv-001', messageId: 'msg-001' },
        ORG_ID,
      );

      // 8. Audit log
      expect(auditLog.ensureMessageReceived).toHaveBeenCalledWith(ORG_ID, 'msg-001');

      // 9. Returns the created message
      expect(result.id).toBe('msg-001');
    });

    it('returns existing message when duplicate is detected', async () => {
      const existingMessage = { ...SAMPLE_MESSAGE, id: 'existing-msg' };
      vi.mocked(messageRepo.findByExternalId).mockResolvedValue(existingMessage);

      const result = await service.processInboundSms(smsPayload, ORG_ID, 'mock');

      expect(result.id).toBe('existing-msg');
      // No contact/message recreation should happen, but idempotent downstream
      // work is repaired in case the first delivery stopped after persistence.
      expect(contactRepo.findByPhone).not.toHaveBeenCalled();
      expect(conversationRepo.findOpenByContactAndChannel).not.toHaveBeenCalled();
      expect(messageRepo.create).not.toHaveBeenCalled();
      expect(jobQueue.enqueue).toHaveBeenCalledWith(
        'process_ai_message',
        { conversationId: existingMessage.conversationId, messageId: existingMessage.id },
        ORG_ID,
      );
      expect(auditLog.ensureMessageReceived).toHaveBeenCalledWith(
        ORG_ID,
        existingMessage.id,
        {},
      );
    });

    it('repairs enqueue and audit work when a provider retries a persisted message', async () => {
      vi.mocked(messageRepo.findByExternalId)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(SAMPLE_MESSAGE);
      vi.mocked(jobQueue.enqueue)
        .mockRejectedValueOnce(new Error('queue unavailable'))
        .mockResolvedValueOnce(SAMPLE_JOB);

      await expect(
        service.processInboundSms(smsPayload, ORG_ID, 'mock'),
      ).rejects.toThrow('queue unavailable');
      await expect(
        service.processInboundSms(smsPayload, ORG_ID, 'mock'),
      ).resolves.toBe(SAMPLE_MESSAGE);

      expect(messageRepo.create).toHaveBeenCalledTimes(1);
      expect(jobQueue.enqueue).toHaveBeenCalledTimes(2);
      expect(auditLog.ensureMessageReceived).toHaveBeenCalledTimes(1);
      expect(auditLog.ensureMessageReceived).toHaveBeenCalledWith(
        ORG_ID,
        SAMPLE_MESSAGE.id,
        {},
      );
    });

    it('rejects a duplicate resolved through another organization before repair writes', async () => {
      const existingMessage = { ...SAMPLE_MESSAGE, id: 'cross-org-message' };
      vi.mocked(messageRepo.findByExternalId).mockResolvedValue(existingMessage);
      vi.mocked(conversationRepo.findById).mockResolvedValue({
        ...SAMPLE_CONVERSATION,
        organizationId: 'org-other',
      });

      await expect(
        service.processInboundSms(smsPayload, ORG_ID, 'mock'),
      ).rejects.toThrow('Inbound message conflicts with receiving route');

      expect(conversationRepo.findById).toHaveBeenCalledWith(existingMessage.conversationId);
      expect(jobQueue.enqueue).not.toHaveBeenCalled();
      expect(auditLog.ensureMessageReceived).not.toHaveBeenCalled();
      expect(contactRepo.findByPhone).not.toHaveBeenCalled();
      expect(messageRepo.create).not.toHaveBeenCalled();
    });

    it('uses existing contact when one is found by phone', async () => {
      const existingContact = { ...SAMPLE_CONTACT, id: 'existing-contact' };
      vi.mocked(contactRepo.findByPhone).mockResolvedValue(existingContact);

      await service.processInboundSms(smsPayload, ORG_ID, 'mock');

      expect(contactRepo.create).not.toHaveBeenCalled();
      expect(conversationRepo.findOpenByContactAndChannel).toHaveBeenCalledWith(
        'existing-contact',
        'sms',
      );
    });

    it('uses existing open conversation when one is found', async () => {
      const existingConv = { ...SAMPLE_CONVERSATION, id: 'existing-conv' };
      vi.mocked(conversationRepo.findOpenByContactAndChannel).mockResolvedValue(existingConv);

      await service.processInboundSms(smsPayload, ORG_ID, 'mock');

      expect(conversationRepo.create).not.toHaveBeenCalled();
      expect(messageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: 'existing-conv' }),
      );
    });

    it('normalizes phone number from raw format', async () => {
      const rawPhonePayload: NormalizedInboundSms = {
        ...smsPayload,
        from: '(555) 123-4567',
      };

      await service.processInboundSms(rawPhonePayload, ORG_ID, 'mock');

      // normalizePhone('(555) 123-4567') → '+15551234567'
      expect(contactRepo.findByPhone).toHaveBeenCalledWith(ORG_ID, '+15551234567');
    });
  });

  describe('processInboundEmail', () => {
    const emailPayload: NormalizedInboundEmail = {
      from: 'customer@example.com',
      to: 'support@company.com',
      subject: 'Help with my order',
      bodyText: 'I need help with order #1234',
      externalMessageId: 'ext-email-001',
      rawPayload: { headers: {} },
    };

    it('processes a new email message through the full flow', async () => {
      const emailContact: Contact = {
        ...SAMPLE_CONTACT,
        phone: null,
        email: 'customer@example.com',
      };
      const emailConversation: Conversation = {
        ...SAMPLE_CONVERSATION,
        channel: 'email',
        subject: 'Help with my order',
      };
      const emailMessage: Message = {
        ...SAMPLE_MESSAGE,
        channel: 'email',
        body: 'I need help with order #1234',
        subject: 'Help with my order',
        provider: 'mock',
        externalMessageId: 'ext-email-001',
      };

      vi.mocked(contactRepo.findByEmail).mockResolvedValue(null);
      vi.mocked(contactRepo.create).mockResolvedValue(emailContact);
      vi.mocked(conversationRepo.create).mockResolvedValue(emailConversation);
      vi.mocked(messageRepo.create).mockResolvedValue(emailMessage);

      const result = await service.processInboundEmail(emailPayload, ORG_ID, 'mock');

      // Contact lookup by email
      expect(contactRepo.findByEmail).toHaveBeenCalledWith(ORG_ID, 'customer@example.com');
      expect(contactRepo.create).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        email: 'customer@example.com',
      });

      // Conversation with email channel
      expect(conversationRepo.findOpenByContactAndChannel).toHaveBeenCalledWith(
        emailContact.id,
        'email',
      );
      expect(conversationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'email',
          subject: 'Help with my order',
        }),
      );

      // Message with email fields
      expect(messageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'email',
          body: 'I need help with order #1234',
          subject: 'Help with my order',
          provider: 'mock',
          externalMessageId: 'ext-email-001',
        }),
      );

      // Job enqueue
      expect(jobQueue.enqueue).toHaveBeenCalledWith(
        'process_ai_message',
        expect.objectContaining({ messageId: emailMessage.id }),
        ORG_ID,
      );

      // Audit log
      expect(auditLog.ensureMessageReceived).toHaveBeenCalledWith(
        ORG_ID,
        emailMessage.id,
      );

      expect(result.channel).toBe('email');
    });

    it('returns existing message when email duplicate is detected', async () => {
      const existingMessage = { ...SAMPLE_MESSAGE, id: 'dup-email' };
      vi.mocked(messageRepo.findByExternalId).mockResolvedValue(existingMessage);

      const result = await service.processInboundEmail(emailPayload, ORG_ID, 'mock');

      expect(result.id).toBe('dup-email');
      expect(contactRepo.findByEmail).not.toHaveBeenCalled();
      expect(messageRepo.create).not.toHaveBeenCalled();
    });

    it('normalizes email address to lowercase', async () => {
      const uppercasePayload: NormalizedInboundEmail = {
        ...emailPayload,
        from: '  Customer@Example.COM  ',
      };

      const emailContact: Contact = {
        ...SAMPLE_CONTACT,
        phone: null,
        email: 'customer@example.com',
      };
      vi.mocked(contactRepo.findByEmail).mockResolvedValue(null);
      vi.mocked(contactRepo.create).mockResolvedValue(emailContact);

      await service.processInboundEmail(uppercasePayload, ORG_ID, 'mock');

      // normalizeEmail trims and lowercases
      expect(contactRepo.findByEmail).toHaveBeenCalledWith(ORG_ID, 'customer@example.com');
    });

    it('uses existing contact when one is found by email', async () => {
      const existingContact: Contact = {
        ...SAMPLE_CONTACT,
        id: 'existing-email-contact',
        email: 'customer@example.com',
      };
      vi.mocked(contactRepo.findByEmail).mockResolvedValue(existingContact);

      await service.processInboundEmail(emailPayload, ORG_ID, 'mock');

      expect(contactRepo.create).not.toHaveBeenCalled();
      expect(conversationRepo.findOpenByContactAndChannel).toHaveBeenCalledWith(
        'existing-email-contact',
        'email',
      );
    });
  });
});
