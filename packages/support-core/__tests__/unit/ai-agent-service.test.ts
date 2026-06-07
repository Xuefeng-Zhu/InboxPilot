import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiAgentService } from '../../src/services/ai-agent-service.js';
import { EscalationEngine } from '../../src/interfaces/escalation.js';
import type { ConversationRepository } from '../../src/repositories/conversation-repository.js';
import type { MessageRepository } from '../../src/repositories/message-repository.js';
import type { KnowledgeRepository } from '../../src/repositories/knowledge-repository.js';
import type { AiSettingsRepository } from '../../src/repositories/ai-settings-repository.js';
import type { AiDecisionRepository } from '../../src/repositories/ai-decision-repository.js';
import type { AuditLogRepository } from '../../src/repositories/audit-log-repository.js';
import type { AiClient } from '../../src/interfaces/ai-client.js';
import type { JobQueue } from '../../src/interfaces/job-queue.js';
import type {
  Conversation,
  Message,
  AiSettings,
  AiDecision,
  AuditLog,
  Job,
} from '../../src/types/index.js';

/**
 * Unit tests for AiAgentService.
 *
 * Tests AI mode gating (off/draft_only/auto_reply), escalation before LLM,
 * and LLM call with mock client.
 */

// ─── Fixtures ─────────────────────────────────────────────────────

const ORG_ID = 'org-001';
const CONV_ID = 'conv-001';

const SAMPLE_CONVERSATION: Conversation = {
  id: CONV_ID,
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
  conversationId: CONV_ID,
  senderType: 'contact',
  senderId: null,
  direction: 'inbound',
  channel: 'sms',
  body: 'How do I return an item?',
  subject: null,
  rawPayload: {},
  provider: 'mock',
  providerAccountId: null,
  externalMessageId: 'ext-001',
  deliveryStatus: 'delivered',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const SAMPLE_AI_SETTINGS: AiSettings = {
  id: 'settings-001',
  organizationId: ORG_ID,
  aiMode: 'draft_only',
  confidenceThreshold: 0.75,
  contextWindowSize: 20,
  maxConsecutiveFailures: 3,
  knowledgeSimilarityThreshold: 0.7,
  escalationKeywords: [],
  systemPrompt: 'You are a helpful support agent.',
  model: 'openai/gpt-4o-mini',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const SAMPLE_AI_DECISION: AiDecision = {
  id: 'decision-001',
  conversationId: CONV_ID,
  organizationId: ORG_ID,
  messageId: 'msg-001',
  decisionType: 'respond',
  confidence: 0.9,
  reasoningSummary: 'Found relevant knowledge',
  responseText: 'You can return items within 30 days.',
  tags: ['returns'],
  requiresHuman: false,
  rawResponse: {},
  createdAt: new Date(),
};

const SAMPLE_AUDIT_LOG: AuditLog = {
  id: 'audit-001',
  organizationId: ORG_ID,
  actorId: null,
  actorType: 'ai',
  action: 'ai_decision_produced',
  resourceType: 'ai_decision',
  resourceId: 'decision-001',
  metadata: {},
  createdAt: new Date(),
};

const SAMPLE_JOB: Job = {
  id: 'job-001',
  organizationId: ORG_ID,
  jobType: 'send_outbound_message',
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

function createMockConversationRepo(): ConversationRepository {
  return {
    findById: vi.fn().mockResolvedValue(SAMPLE_CONVERSATION),
    findOpenByContactAndChannel: vi.fn(),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue(SAMPLE_CONVERSATION),
    listByOrg: vi.fn(),
  } as unknown as ConversationRepository;
}

function createMockMessageRepo(): MessageRepository {
  return {
    findByExternalId: vi.fn(),
    create: vi.fn(),
    listByConversation: vi.fn().mockResolvedValue([SAMPLE_MESSAGE]),
  } as unknown as MessageRepository;
}

function createMockKnowledgeRepo(): KnowledgeRepository {
  return {
    matchChunks: vi.fn().mockResolvedValue([]),
    getDocument: vi.fn(),
    createDocument: vi.fn(),
    updateDocument: vi.fn(),
    deleteDocumentWithChunks: vi.fn(),
    insertChunks: vi.fn(),
    deleteChunksByDocument: vi.fn(),
  } as unknown as KnowledgeRepository;
}

function createMockAiSettingsRepo(settings: AiSettings | null = SAMPLE_AI_SETTINGS): AiSettingsRepository {
  return {
    findByOrg: vi.fn().mockResolvedValue(settings),
    create: vi.fn(),
    update: vi.fn(),
  } as unknown as AiSettingsRepository;
}

function createMockAiDecisionRepo(): AiDecisionRepository {
  return {
    create: vi.fn().mockResolvedValue(SAMPLE_AI_DECISION),
    findLatestByConversation: vi.fn(),
    listRecentByConversation: vi.fn().mockResolvedValue([]),
    // Default: no recent failures. Specific tests override this to drive
    // RepeatedFailureRule behaviour (HIGH-2 regression).
    countConsecutiveFailures: vi.fn().mockResolvedValue(0),
  } as unknown as AiDecisionRepository;
}

function createMockAuditLog(): AuditLogRepository {
  return {
    create: vi.fn().mockResolvedValue(SAMPLE_AUDIT_LOG),
  } as unknown as AuditLogRepository;
}

function createMockAiClient(responseContent: string = JSON.stringify({
  decision_type: 'respond',
  confidence: 0.9,
  reasoning_summary: 'Found relevant knowledge',
  response_text: 'You can return items within 30 days.',
  tags: ['returns'],
  requires_human: false,
})): AiClient {
  return {
    chatCompletion: vi.fn().mockResolvedValue({ content: responseContent }),
    createEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0)),
  };
}

function createMockJobQueue(): JobQueue {
  return {
    enqueue: vi.fn().mockResolvedValue(SAMPLE_JOB),
    claim: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────

describe('AiAgentService', () => {
  let conversationRepo: ReturnType<typeof createMockConversationRepo>;
  let messageRepo: ReturnType<typeof createMockMessageRepo>;
  let knowledgeRepo: ReturnType<typeof createMockKnowledgeRepo>;
  let aiSettingsRepo: ReturnType<typeof createMockAiSettingsRepo>;
  let aiDecisionRepo: ReturnType<typeof createMockAiDecisionRepo>;
  let auditLog: ReturnType<typeof createMockAuditLog>;
  let aiClient: ReturnType<typeof createMockAiClient>;
  let jobQueue: ReturnType<typeof createMockJobQueue>;
  let escalationEngine: EscalationEngine;

  function createService() {
    return new AiAgentService(
      conversationRepo,
      messageRepo,
      knowledgeRepo,
      aiSettingsRepo,
      aiDecisionRepo,
      escalationEngine,
      aiClient,
      jobQueue,
      auditLog,
    );
  }

  beforeEach(() => {
    conversationRepo = createMockConversationRepo();
    messageRepo = createMockMessageRepo();
    knowledgeRepo = createMockKnowledgeRepo();
    aiSettingsRepo = createMockAiSettingsRepo();
    aiDecisionRepo = createMockAiDecisionRepo();
    auditLog = createMockAuditLog();
    aiClient = createMockAiClient();
    jobQueue = createMockJobQueue();
    escalationEngine = new EscalationEngine();
  });

  describe('AI mode gating', () => {
    it('skips all processing when AI mode is "off"', async () => {
      aiSettingsRepo = createMockAiSettingsRepo({
        ...SAMPLE_AI_SETTINGS,
        aiMode: 'off',
      });
      const service = createService();

      await service.processMessage(CONV_ID, ORG_ID);

      // Should NOT call LLM
      expect(aiClient.chatCompletion).not.toHaveBeenCalled();
      // Should NOT load conversation or messages
      expect(conversationRepo.findById).not.toHaveBeenCalled();
      // Should create a skip decision
      expect(aiDecisionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          reasoningSummary: expect.stringContaining('disabled'),
        }),
      );
      // Should record audit log
      expect(auditLog.create).toHaveBeenCalled();
    });

    it('stores draft without sending when mode is "draft_only"', async () => {
      aiSettingsRepo = createMockAiSettingsRepo({
        ...SAMPLE_AI_SETTINGS,
        aiMode: 'draft_only',
      });
      const service = createService();

      await service.processMessage(CONV_ID, ORG_ID);

      // Should call LLM
      expect(aiClient.chatCompletion).toHaveBeenCalled();
      // Should set ai_state to "drafted"
      expect(conversationRepo.update).toHaveBeenCalledWith(
        CONV_ID,
        expect.objectContaining({ aiState: 'drafted' }),
      );
      // Should NOT enqueue outbound message
      expect(jobQueue.enqueue).not.toHaveBeenCalled();
    });

    it('auto-sends when mode is "auto_reply" and confidence meets threshold', async () => {
      aiSettingsRepo = createMockAiSettingsRepo({
        ...SAMPLE_AI_SETTINGS,
        aiMode: 'auto_reply',
        confidenceThreshold: 0.8,
      });
      // LLM returns high confidence
      aiClient = createMockAiClient(JSON.stringify({
        decision_type: 'respond',
        confidence: 0.95,
        reasoning_summary: 'High confidence answer',
        response_text: 'Here is your answer.',
        tags: [],
        requires_human: false,
      }));
      const service = createService();

      await service.processMessage(CONV_ID, ORG_ID);

      // Should set ai_state to "auto_replied"
      expect(conversationRepo.update).toHaveBeenCalledWith(
        CONV_ID,
        expect.objectContaining({ aiState: 'auto_replied' }),
      );
      // Should enqueue outbound message
      expect(jobQueue.enqueue).toHaveBeenCalledWith(
        'send_outbound_message',
        expect.objectContaining({ conversation_id: CONV_ID }),
        ORG_ID,
      );
    });
  });

  describe('escalation before LLM', () => {
    it('escalates when message contains human request phrase', async () => {
      // Register a simple rule that triggers on "speak to a human"
      const { HumanRequestRule } = await import('../../src/services/escalation-rules.js');
      escalationEngine.register(new HumanRequestRule());

      vi.mocked(messageRepo.listByConversation).mockResolvedValue([
        { ...SAMPLE_MESSAGE, body: 'I want to speak to a human please' },
      ]);

      const service = createService();
      await service.processMessage(CONV_ID, ORG_ID);

      // Should NOT call LLM
      expect(aiClient.chatCompletion).not.toHaveBeenCalled();
      // Should set status to "escalated" and ai_state to "needs_human"
      expect(conversationRepo.update).toHaveBeenCalledWith(
        CONV_ID,
        expect.objectContaining({
          status: 'escalated',
          aiState: 'needs_human',
        }),
      );
      // Should create escalation decision
      expect(aiDecisionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          decisionType: 'escalate',
          requiresHuman: true,
        }),
      );
    });
  });

  describe('LLM call with mock', () => {
    it('calls LLM and creates decision on success', async () => {
      const service = createService();

      await service.processMessage(CONV_ID, ORG_ID);

      // Should call LLM
      expect(aiClient.chatCompletion).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'openai/gpt-4o-mini',
          responseFormat: { type: 'json_object' },
        }),
      );
      // Should create AI decision
      expect(aiDecisionRepo.create).toHaveBeenCalled();
      // Should record audit log
      expect(auditLog.create).toHaveBeenCalled();
    });

    it('sets ai_state to "failed" when LLM returns invalid JSON', async () => {
      aiClient = createMockAiClient('not valid json at all');
      const service = createService();

      await service.processMessage(CONV_ID, ORG_ID);

      // Should set ai_state to "failed"
      expect(conversationRepo.update).toHaveBeenCalledWith(
        CONV_ID,
        expect.objectContaining({ aiState: 'failed' }),
      );
    });

    it('sets ai_state to "failed" when LLM call throws', async () => {
      aiClient = {
        chatCompletion: vi.fn().mockRejectedValue(new Error('LLM timeout')),
        createEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0)),
      };
      const service = createService();

      await service.processMessage(CONV_ID, ORG_ID);

      // Should set ai_state to "failed"
      expect(conversationRepo.update).toHaveBeenCalledWith(
        CONV_ID,
        expect.objectContaining({ aiState: 'failed' }),
      );
    });
  });

  // ─── Regression: HIGH-2 — RepeatedFailureRule must be data-driven ───
  //
  // Prior to this fix, `countConsecutiveFailures` returned 0 or 1 based
  // on `ai_state` alone, so `RepeatedFailureRule` (default
  // `maxConsecutiveFailures = 3`) could never trigger in production.
  // The fix delegates the count to `AiDecisionRepository`. This test
  // wires that count up via a mock and asserts the conversation is
  // escalated by `RepeatedFailureRule` exactly when the count meets
  // the configured threshold.
  describe('RepeatedFailureRule (HIGH-2 regression)', () => {
    it('escalates when consecutive AI failures from the repo reach maxConsecutiveFailures', async () => {
      const { RepeatedFailureRule } = await import('../../src/services/escalation-rules.js');
      escalationEngine.register(new RepeatedFailureRule());

      // Mock the new repo method to return 3 (the launch scenario).
      vi.mocked(aiDecisionRepo.countConsecutiveFailures).mockResolvedValue(3);

      const service = createService();
      await service.processMessage(CONV_ID, ORG_ID);

      // The repo must have been consulted
      expect(aiDecisionRepo.countConsecutiveFailures).toHaveBeenCalledWith(CONV_ID, 10);

      // Should escalate the conversation to a human, skipping the LLM
      expect(aiClient.chatCompletion).not.toHaveBeenCalled();
      expect(conversationRepo.update).toHaveBeenCalledWith(
        CONV_ID,
        expect.objectContaining({
          status: 'escalated',
          aiState: 'needs_human',
        }),
      );
      // The escalation decision should be attributed to RepeatedFailureRule
      expect(aiDecisionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          decisionType: 'escalate',
          requiresHuman: true,
          tags: ['escalated'],
        }),
      );
      const escalateCall = vi.mocked(aiDecisionRepo.create).mock.calls.find(
        (call) => (call[0] as { decisionType: string }).decisionType === 'escalate',
      );
      expect(escalateCall).toBeDefined();
      expect((escalateCall![0] as { reasoningSummary: string }).reasoningSummary)
        .toContain('RepeatedFailureRule');
    });

    it('does NOT escalate when consecutive failures are below max', async () => {
      const { RepeatedFailureRule } = await import('../../src/services/escalation-rules.js');
      escalationEngine.register(new RepeatedFailureRule());

      // 2 failures — below the default max of 3, so the rule must not fire.
      vi.mocked(aiDecisionRepo.countConsecutiveFailures).mockResolvedValue(2);

      const service = createService();
      await service.processMessage(CONV_ID, ORG_ID);

      // LLM is called because no rule fired
      expect(aiClient.chatCompletion).toHaveBeenCalled();
      // No escalation update
      const updates = vi.mocked(conversationRepo.update).mock.calls;
      const escalated = updates.some(
        (call) => (call[1] as { status?: string })?.status === 'escalated',
      );
      expect(escalated).toBe(false);
    });

    it('does NOT escalate when there are zero recent failures (the prior behaviour)', async () => {
      const { RepeatedFailureRule } = await import('../../src/services/escalation-rules.js');
      escalationEngine.register(new RepeatedFailureRule());

      vi.mocked(aiDecisionRepo.countConsecutiveFailures).mockResolvedValue(0);

      const service = createService();
      await service.processMessage(CONV_ID, ORG_ID);

      expect(aiClient.chatCompletion).toHaveBeenCalled();
      const updates = vi.mocked(conversationRepo.update).mock.calls;
      const escalated = updates.some(
        (call) => (call[1] as { status?: string })?.status === 'escalated',
      );
      expect(escalated).toBe(false);
    });
  });
});
