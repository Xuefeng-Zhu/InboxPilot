import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { InboundMessageService } from '@support-core/services/inbound-message-service';
import type { ContactRepository } from '@support-core/repositories/contact-repository';
import type { ConversationRepository } from '@support-core/repositories/conversation-repository';
import type { MessageRepository } from '@support-core/repositories/message-repository';
import type { AuditLogRepository } from '@support-core/repositories/audit-log-repository';
import type { JobQueue } from '@support-core/interfaces/job-queue';
import type {
  Contact,
  Conversation,
  Message,
  Job,
  NormalizedInboundSms,
} from '@support-core/types/index';

/**
 * Property-based tests for message deduplication idempotence.
 *
 * Feature: ai-customer-support
 */

describe('Message deduplication property tests', () => {
  /**
   * Property 7: Message deduplication idempotence
   *
   * For any inbound message with a given (provider, external_message_id) pair,
   * processing the message N times (N ≥ 1) SHALL result in exactly one stored
   * Message record. Subsequent processing attempts SHALL repair idempotent
   * follow-up work without creating another message.
   *
   * **Validates: Requirements 6.2, 6.3, 29.3**
   *
   * Feature: ai-customer-support, Property 7: Message deduplication idempotence
   */
  it('Property 7: processing the same (provider, externalMessageId) N times creates exactly one message', async () => {
    // Generator for provider strings (non-empty alphanumeric)
    const providerArb = fc.stringOf(
      fc.constantFrom(
        ...'abcdefghijklmnopqrstuvwxyz0123456789_-'.split('')
      ),
      { minLength: 1, maxLength: 20 }
    );

    // Generator for external message IDs (non-empty)
    const externalMessageIdArb = fc.stringOf(
      fc.constantFrom(
        ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'.split('')
      ),
      { minLength: 1, maxLength: 64 }
    );

    // Generator for E.164 phone numbers
    const phoneArb = fc
      .tuple(
        fc.integer({ min: 200, max: 999 }),
        fc.integer({ min: 200, max: 999 }),
        fc.integer({ min: 0, max: 9999 })
      )
      .map(([area, exchange, sub]) => `+1${area}${exchange}${sub.toString().padStart(4, '0')}`);

    // Generator for message body (non-empty)
    const bodyArb = fc.string({ minLength: 1, maxLength: 200 });

    // Generator for N (number of times to process, 1 to 5)
    const nArb = fc.integer({ min: 1, max: 5 });

    // Generator for org IDs
    const orgIdArb = fc.stringOf(
      fc.constantFrom(
        ...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')
      ),
      { minLength: 1, maxLength: 20 }
    ).map((s) => `org-${s}`);

    await fc.assert(
      fc.asyncProperty(
        providerArb,
        externalMessageIdArb,
        phoneArb,
        bodyArb,
        nArb,
        orgIdArb,
        async (provider, externalMessageId, phone, body, n, orgId) => {
          // ── Build mock repositories ──────────────────────────────

          const messageId = `msg-${externalMessageId}`;
          const contactId = `contact-${phone}`;
          const conversationId = `conv-${contactId}`;

          const createdMessage: Message = {
            id: messageId,
            conversationId,
            senderType: 'contact',
            senderId: null,
            direction: 'inbound',
            channel: 'sms',
            body,
            subject: null,
            rawPayload: {},
            provider,
            providerAccountId: null,
            externalMessageId,
            deliveryStatus: 'delivered',
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          const contact: Contact = {
            id: contactId,
            organizationId: orgId,
            name: null,
            email: null,
            phone,
            metadata: {},
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          const conversation: Conversation = {
            id: conversationId,
            organizationId: orgId,
            contactId,
            channel: 'sms',
            status: 'open',
            aiState: 'idle',
            subject: null,
            assignedTo: null,
            lastMessageAt: null,
            metadata: {},
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          const job: Job = {
            id: 'job-1',
            organizationId: orgId,
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

          // Track whether the message has been "created" (simulates DB state)
          let messageCreated = false;

          const messageRepo = {
            findByExternalId: vi.fn().mockImplementation(async () => {
              // First call returns null (no duplicate), subsequent calls return the created message
              return messageCreated ? createdMessage : null;
            }),
            create: vi.fn().mockImplementation(async () => {
              messageCreated = true;
              return createdMessage;
            }),
            listByConversation: vi.fn(),
          } as unknown as MessageRepository;

          const contactRepo = {
            findByPhone: vi.fn().mockResolvedValue(contact),
            findByEmail: vi.fn(),
            create: vi.fn().mockResolvedValue(contact),
            update: vi.fn(),
          } as unknown as ContactRepository;

          const conversationRepo = {
            findOpenByContactAndChannel: vi.fn().mockResolvedValue(conversation),
            create: vi.fn().mockResolvedValue(conversation),
            update: vi.fn().mockResolvedValue(conversation),
            listByOrg: vi.fn(),
          } as unknown as ConversationRepository;

          const auditLog = {
            ensureMessageReceived: vi.fn().mockResolvedValue(undefined),
          } as unknown as AuditLogRepository;

          const jobQueue: JobQueue = {
            enqueue: vi.fn().mockResolvedValue(job),
            claim: vi.fn(),
            complete: vi.fn(),
            fail: vi.fn(),
          };

          // ── Create service and process N times ───────────────────

          const service = new InboundMessageService(
            contactRepo,
            conversationRepo,
            messageRepo,
            jobQueue,
            auditLog,
          );

          const payload: NormalizedInboundSms = {
            from: phone,
            to: '+15550000000',
            body,
            externalMessageId,
            rawPayload: {},
          };

          const results: Message[] = [];
          for (let i = 0; i < n; i++) {
            const result = await service.processInboundSms(payload, orgId, provider);
            results.push(result);
          }

          // ── Assertions ───────────────────────────────────────────

          // messageRepo.create should have been called exactly once
          expect(messageRepo.create).toHaveBeenCalledTimes(1);

          // All N results should return the same message id
          for (const result of results) {
            expect(result.id).toBe(messageId);
          }

          // findByExternalId should have been called N times total
          expect(messageRepo.findByExternalId).toHaveBeenCalledTimes(n);

          // Every call to findByExternalId used the correct (provider, externalMessageId)
          for (const call of (messageRepo.findByExternalId as ReturnType<typeof vi.fn>).mock.calls) {
            expect(call[0]).toBe(provider);
            expect(call[1]).toBe(externalMessageId);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
