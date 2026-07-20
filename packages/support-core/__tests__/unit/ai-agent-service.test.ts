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
  CreateAiDecisionInput,
  AuditLog,
  Job,
} from '../../src/types/index.js';
import { DEFAULT_EMBEDDING_MODEL } from '../../src/types/ai-models.js';

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
  embeddingModel: DEFAULT_EMBEDDING_MODEL,
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
    transitionAiSourceTurn: vi.fn().mockResolvedValue(true),
    listByOrg: vi.fn(),
  } as unknown as ConversationRepository;
}

function createMockMessageRepo(): MessageRepository {
  return {
    findById: vi.fn().mockResolvedValue(SAMPLE_MESSAGE),
    findByExternalId: vi.fn(),
    findLatestByConversation: vi.fn().mockResolvedValue(SAMPLE_MESSAGE),
    create: vi.fn(),
    listByConversation: vi.fn().mockResolvedValue([SAMPLE_MESSAGE]),
    listByConversationThroughMessage: vi.fn().mockResolvedValue([SAMPLE_MESSAGE]),
  } as unknown as MessageRepository;
}

function createMockKnowledgeRepo(): KnowledgeRepository {
  return {
    matchChunks: vi.fn().mockResolvedValue([]),
    searchChunksByText: vi.fn().mockResolvedValue([]),
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
    create: vi.fn().mockImplementation(async (input: CreateAiDecisionInput): Promise<AiDecision> => ({
      id: SAMPLE_AI_DECISION.id,
      conversationId: input.conversationId,
      organizationId: input.organizationId,
      sourceJobId: input.sourceJobId ?? null,
      messageId: input.messageId ?? null,
      decisionType: input.decisionType,
      confidence: input.confidence,
      reasoningSummary: input.reasoningSummary ?? null,
      responseText: input.responseText ?? null,
      tags: input.tags ?? [],
      requiresHuman: input.requiresHuman,
      rawResponse: input.rawResponse ?? null,
      createdAt: SAMPLE_AI_DECISION.createdAt,
    })),
    findBySourceJobId: vi.fn().mockResolvedValue(null),
    findLatestByConversation: vi.fn(),
  } as unknown as AiDecisionRepository;
}

function createMockAuditLog(): AuditLogRepository {
  return {
    create: vi.fn().mockResolvedValue(SAMPLE_AUDIT_LOG),
    existsForActionResource: vi.fn().mockResolvedValue(false),
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

  describe('source message binding', () => {
    it('suppresses work when a newer inbound wins before the initial atomic claim', async () => {
      vi.mocked(conversationRepo.transitionAiSourceTurn).mockResolvedValueOnce(false);
      const service = createService();

      await expect(service.processMessage(CONV_ID, ORG_ID, {
        sourceJobId: 'job-old',
        sourceMessageId: SAMPLE_MESSAGE.id,
      })).resolves.toBeNull();

      expect(messageRepo.findById).toHaveBeenCalledWith(SAMPLE_MESSAGE.id);
      expect(messageRepo.listByConversationThroughMessage).not.toHaveBeenCalled();
      expect(conversationRepo.update).not.toHaveBeenCalled();
      expect(conversationRepo.transitionAiSourceTurn).toHaveBeenCalledWith(
        CONV_ID,
        ORG_ID,
        SAMPLE_MESSAGE.id,
        'thinking',
        undefined,
        { status: 'open' },
      );
      expect(aiClient.createEmbedding).not.toHaveBeenCalled();
      expect(aiClient.chatCompletion).not.toHaveBeenCalled();
      expect(aiDecisionRepo.create).not.toHaveBeenCalled();
    });

    it('builds context through the immutable source and records that message ID', async () => {
      const service = createService();

      const result = await service.processMessage(CONV_ID, ORG_ID, {
        sourceJobId: 'job-current',
        sourceMessageId: SAMPLE_MESSAGE.id,
      });

      expect(messageRepo.listByConversationThroughMessage).toHaveBeenCalledWith(
        CONV_ID,
        SAMPLE_MESSAGE,
        SAMPLE_AI_SETTINGS.contextWindowSize,
      );
      expect(messageRepo.listByConversation).not.toHaveBeenCalled();
      expect(result?.messageId).toBe(SAMPLE_MESSAGE.id);
      expect(aiDecisionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ messageId: SAMPLE_MESSAGE.id }),
      );
      expect(conversationRepo.transitionAiSourceTurn).toHaveBeenNthCalledWith(
        1,
        CONV_ID,
        ORG_ID,
        SAMPLE_MESSAGE.id,
        'thinking',
        undefined,
        { status: 'open' },
      );
      expect(conversationRepo.transitionAiSourceTurn).toHaveBeenNthCalledWith(
        2,
        CONV_ID,
        ORG_ID,
        SAMPLE_MESSAGE.id,
        'drafted',
        undefined,
        { aiState: 'thinking', status: 'open' },
      );
    });

    it.each([
      { manualStatus: 'resolved', manualAiState: 'idle' },
      { manualStatus: 'escalated', manualAiState: 'needs_human' },
    ] as const)(
      'does not overwrite a manual $manualStatus action during generation',
      async ({ manualAiState }) => {
        let simulatedAiState: 'idle' | 'thinking' | 'needs_human' = 'idle';
        vi.mocked(conversationRepo.transitionAiSourceTurn)
          .mockImplementationOnce(async () => {
            simulatedAiState = 'thinking';
            return true;
          })
          .mockImplementationOnce(async () => {
            // Manual resolve/escalate changes the expected state/status before
            // the stale final CAS is evaluated.
            simulatedAiState = manualAiState;
            return false;
          });
        const service = createService();

        await expect(service.processMessage(CONV_ID, ORG_ID, {
          sourceJobId: 'job-raced',
          sourceMessageId: SAMPLE_MESSAGE.id,
        })).resolves.toBeNull();

        expect(aiClient.createEmbedding).toHaveBeenCalledOnce();
        expect(aiClient.chatCompletion).toHaveBeenCalledOnce();
        expect(aiDecisionRepo.create).not.toHaveBeenCalled();
        expect(conversationRepo.update).not.toHaveBeenCalled();
        expect(conversationRepo.transitionAiSourceTurn).toHaveBeenNthCalledWith(
          2,
          CONV_ID,
          ORG_ID,
          SAMPLE_MESSAGE.id,
          'drafted',
          undefined,
          { aiState: 'thinking', status: 'open' },
        );
        expect(simulatedAiState).toBe(manualAiState);
      },
    );

    it('does not persist a stale auto-reply when a new inbound wins the reply-intent claim', async () => {
      aiSettingsRepo = createMockAiSettingsRepo({
        ...SAMPLE_AI_SETTINGS,
        aiMode: 'auto_reply',
        confidenceThreshold: 0.8,
      });
      vi.mocked(conversationRepo.transitionAiSourceTurn)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      const service = createService();

      await expect(service.processMessage(CONV_ID, ORG_ID, {
        sourceJobId: 'job-raced-auto-reply',
        sourceMessageId: SAMPLE_MESSAGE.id,
      })).resolves.toBeNull();

      expect(conversationRepo.transitionAiSourceTurn).toHaveBeenNthCalledWith(
        2,
        CONV_ID,
        ORG_ID,
        SAMPLE_MESSAGE.id,
        'auto_replied',
        undefined,
        { aiState: 'thinking', status: 'open' },
      );
      expect(aiDecisionRepo.create).not.toHaveBeenCalled();
    });
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
      // Loads the conversation only to enforce the tenant boundary.
      expect(conversationRepo.findById).toHaveBeenCalledWith(CONV_ID);
      expect(messageRepo.listByConversation).not.toHaveBeenCalled();
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

      const result = await service.processMessage(
        CONV_ID,
        ORG_ID,
        { sourceJobId: 'job-auto-reply-001' },
      );

      // Should set ai_state to "auto_replied"
      expect(conversationRepo.update).toHaveBeenCalledWith(
        CONV_ID,
        expect.objectContaining({ aiState: 'auto_replied' }),
      );
      // Should return a decision with responseText (the caller sends it inline)
      expect(result?.responseText).toBe('Here is your answer.');
      expect(result?.requiresHuman).toBe(false);
      expect(result?.rawResponse).toMatchObject({ _shouldAutoSend: true });
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

    it('escalates sensitive topics before calling the LLM', async () => {
      const { SensitiveTopicRule } = await import('../../src/services/escalation-rules.js');
      escalationEngine.register(new SensitiveTopicRule());

      vi.mocked(messageRepo.listByConversation).mockResolvedValue([
        { ...SAMPLE_MESSAGE, body: 'I am filing a chargeback for this order' },
      ]);

      const service = createService();
      await service.processMessage(CONV_ID, ORG_ID);

      expect(aiClient.chatCompletion).not.toHaveBeenCalled();
      expect(conversationRepo.update).toHaveBeenCalledWith(
        CONV_ID,
        expect.objectContaining({
          status: 'escalated',
          aiState: 'needs_human',
        }),
      );
      expect(aiDecisionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          decisionType: 'escalate',
          requiresHuman: true,
        }),
      );
    });

    it('escalates safety topics before calling the LLM', async () => {
      const { SafetyConcernRule } = await import('../../src/services/escalation-rules.js');
      escalationEngine.register(new SafetyConcernRule());

      vi.mocked(messageRepo.listByConversation).mockResolvedValue([
        { ...SAMPLE_MESSAGE, body: 'I think my account was hacked' },
      ]);

      const service = createService();
      await service.processMessage(CONV_ID, ORG_ID);

      expect(aiClient.chatCompletion).not.toHaveBeenCalled();
      expect(conversationRepo.update).toHaveBeenCalledWith(
        CONV_ID,
        expect.objectContaining({
          status: 'escalated',
          aiState: 'needs_human',
        }),
      );
      expect(aiDecisionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          decisionType: 'escalate',
          requiresHuman: true,
        }),
      );
    });

    it('does not trigger MissingKnowledgeRule when lexical fallback finds a matching chunk', async () => {
      const { MissingKnowledgeRule } = await import('../../src/services/escalation-rules.js');
      escalationEngine.register(new MissingKnowledgeRule());

      vi.mocked(messageRepo.listByConversation).mockResolvedValue([
        { ...SAMPLE_MESSAGE, body: 'free plan' },
      ]);
      vi.mocked(knowledgeRepo.searchChunksByText).mockResolvedValue([
        {
          id: 'chunk-free-plan',
          documentId: 'doc-pricing',
          organizationId: ORG_ID,
          content: 'The free plan includes one inbox and basic webchat support.',
          embedding: [],
          metadata: {},
          createdAt: new Date('2024-01-01'),
        },
      ]);

      const service = createService();

      await service.processMessage(CONV_ID, ORG_ID);

      expect(knowledgeRepo.matchChunks).toHaveBeenCalled();
      expect(knowledgeRepo.searchChunksByText).toHaveBeenCalledWith(
        ORG_ID,
        'free plan',
        5,
      );
      expect(aiClient.chatCompletion).toHaveBeenCalled();
      expect(aiDecisionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          decisionType: 'respond',
          requiresHuman: false,
        }),
      );
      expect(conversationRepo.update).not.toHaveBeenCalledWith(
        CONV_ID,
        expect.objectContaining({
          status: 'escalated',
          aiState: 'needs_human',
        }),
      );
    });

    it('lets a greeting with no knowledge chunks reach the LLM as clarify', async () => {
      const { createDefaultEscalationEngine } = await import('../../src/services/escalation-rules.js');
      escalationEngine = createDefaultEscalationEngine();
      aiClient = createMockAiClient(JSON.stringify({
        decision_type: 'clarify',
        confidence: 0.8,
        reasoning_summary: 'No knowledge was found, so ask what the customer needs.',
        response_text: 'Hi! What can I help you with today?',
        tags: ['clarify'],
        requires_human: false,
      }));
      vi.mocked(messageRepo.listByConversation).mockResolvedValue([
        { ...SAMPLE_MESSAGE, body: 'hello' },
      ]);

      const service = createService();
      await service.processMessage(CONV_ID, ORG_ID);

      expect(aiClient.chatCompletion).toHaveBeenCalled();
      const chatArgs = vi.mocked(aiClient.chatCompletion).mock.calls[0]?.[0];
      expect(chatArgs?.messages[0]?.content).toContain('No relevant knowledge base article was found');
      expect(aiDecisionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          decisionType: 'clarify',
          requiresHuman: false,
        }),
      );
      expect(conversationRepo.update).not.toHaveBeenCalledWith(
        CONV_ID,
        expect.objectContaining({
          status: 'escalated',
          aiState: 'needs_human',
        }),
      );
    });

    it('lets a substantive no-knowledge request produce a clarify decision', async () => {
      const { createDefaultEscalationEngine } = await import('../../src/services/escalation-rules.js');
      escalationEngine = createDefaultEscalationEngine();
      aiClient = createMockAiClient(JSON.stringify({
        decision_type: 'clarify',
        confidence: 0.7,
        reasoning_summary: 'No grounded answer is available from the knowledge base.',
        response_text: 'Could you share which account setting you are trying to change?',
        tags: ['clarify'],
        requires_human: false,
      }));
      vi.mocked(messageRepo.listByConversation).mockResolvedValue([
        { ...SAMPLE_MESSAGE, body: 'How do I change an account setting?' },
      ]);

      const service = createService();
      await service.processMessage(CONV_ID, ORG_ID);

      expect(aiClient.chatCompletion).toHaveBeenCalled();
      expect(aiDecisionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          decisionType: 'clarify',
          requiresHuman: false,
        }),
      );
      expect(conversationRepo.update).not.toHaveBeenCalledWith(
        CONV_ID,
        expect.objectContaining({
          status: 'escalated',
          aiState: 'needs_human',
        }),
      );
    });
  });

  describe('low confidence handling', () => {
    it('does not escalate low-confidence clarify decisions', async () => {
      aiClient = createMockAiClient(JSON.stringify({
        decision_type: 'clarify',
        confidence: 0.2,
        reasoning_summary: 'Need more information before answering.',
        response_text: 'Could you share a few more details?',
        tags: ['clarify'],
        requires_human: false,
      }));
      const service = createService();

      await service.processMessage(CONV_ID, ORG_ID);

      expect(aiDecisionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          decisionType: 'clarify',
          confidence: 0.2,
          requiresHuman: false,
        }),
      );
      expect(conversationRepo.update).not.toHaveBeenCalledWith(
        CONV_ID,
        expect.objectContaining({
          status: 'escalated',
          aiState: 'needs_human',
        }),
      );
    });

    it('still escalates low-confidence respond decisions', async () => {
      aiClient = createMockAiClient(JSON.stringify({
        decision_type: 'respond',
        confidence: 0.2,
        reasoning_summary: 'Weak answer with insufficient confidence.',
        response_text: 'This may be possible.',
        tags: ['low_confidence'],
        requires_human: false,
      }));
      const service = createService();

      await service.processMessage(CONV_ID, ORG_ID);

      expect(conversationRepo.update).toHaveBeenCalledWith(
        CONV_ID,
        expect.objectContaining({
          status: 'escalated',
          aiState: 'needs_human',
        }),
      );
      expect(aiDecisionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          decisionType: 'escalate',
          confidence: 0.2,
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
      // Should call createEmbedding with the configured embedding model
      expect(aiClient.createEmbedding).toHaveBeenCalledWith(
        expect.objectContaining({
          model: SAMPLE_AI_SETTINGS.embeddingModel,
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

    it('propagates chunk-reference enqueue failures so the worker can retry', async () => {
      vi.mocked(knowledgeRepo.matchChunks).mockResolvedValue([
        {
          id: 'chunk-001',
          documentId: 'doc-001',
          organizationId: ORG_ID,
          content: 'Returns are accepted within 30 days.',
          embedding: [],
          metadata: {},
          createdAt: new Date('2024-01-01'),
        },
      ]);
      vi.mocked(jobQueue.enqueue).mockRejectedValue(new Error('queue unavailable'));
      const service = createService();

      await expect(service.processMessage(CONV_ID, ORG_ID)).rejects.toThrow('queue unavailable');
      expect(aiDecisionRepo.create).toHaveBeenCalledTimes(1);
      expect(jobQueue.enqueue).toHaveBeenCalledTimes(1);
      expect(conversationRepo.update).not.toHaveBeenCalledWith(
        CONV_ID,
        expect.objectContaining({ aiState: 'failed' }),
      );
      expect(jobQueue.enqueue).toHaveBeenCalledWith(
        'record_chunk_refs',
        expect.objectContaining({
          ai_decision_id: expect.any(String),
          knowledge_chunk_ids: ['chunk-001'],
        }),
        ORG_ID,
      );
    });

    it('resumes downstream work without creating a second decision on worker retry', async () => {
      vi.mocked(knowledgeRepo.matchChunks).mockResolvedValue([
        {
          id: 'chunk-001',
          documentId: 'doc-001',
          organizationId: ORG_ID,
          content: 'Returns are accepted within 30 days.',
          embedding: [],
          metadata: {},
          createdAt: new Date('2024-01-01'),
        },
      ]);
      vi.mocked(jobQueue.enqueue)
        .mockRejectedValueOnce(new Error('queue unavailable'))
        .mockResolvedValue(SAMPLE_JOB);
      const sourceJobId = 'job-process-ai-001';
      const persistedDecision: AiDecision = {
        ...SAMPLE_AI_DECISION,
        conversationId: CONV_ID,
        organizationId: ORG_ID,
        sourceJobId,
        rawResponse: {
          decision_type: 'respond',
          _groundingChunkIds: ['chunk-001'],
          _auditMetadata: {
            decisionType: 'respond',
            mode: 'draft_only',
          },
        },
      };
      vi.mocked(aiDecisionRepo.findBySourceJobId)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(persistedDecision);
      const service = createService();

      await expect(
        service.processMessage(CONV_ID, ORG_ID, { sourceJobId }),
      ).rejects.toThrow('queue unavailable');
      await expect(
        service.processMessage(CONV_ID, ORG_ID, { sourceJobId }),
      ).resolves.toBe(persistedDecision);

      expect(aiDecisionRepo.create).toHaveBeenCalledTimes(1);
      expect(aiDecisionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceJobId,
          rawResponse: expect.objectContaining({
            _groundingChunkIds: ['chunk-001'],
          }),
        }),
      );
      expect(aiClient.chatCompletion).toHaveBeenCalledTimes(1);
      expect(jobQueue.enqueue).toHaveBeenCalledTimes(2);
      expect(auditLog.create).toHaveBeenCalledTimes(1);
      expect(auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceId: persistedDecision.id,
          metadata: { decisionType: 'respond', mode: 'draft_only' },
        }),
      );
    });

    it('does not duplicate an existing decision audit when later handler work retries', async () => {
      const sourceJobId = 'job-process-ai-001';
      vi.mocked(aiDecisionRepo.findBySourceJobId).mockResolvedValue({
        ...SAMPLE_AI_DECISION,
        conversationId: CONV_ID,
        organizationId: ORG_ID,
        sourceJobId,
        rawResponse: { _groundingChunkIds: [] },
      });
      vi.mocked(auditLog.existsForActionResource).mockResolvedValue(true);
      const service = createService();

      await service.processMessage(CONV_ID, ORG_ID, { sourceJobId });

      expect(auditLog.existsForActionResource).toHaveBeenCalledWith(
        ORG_ID,
        'ai_decision_produced',
        'ai_decision',
        SAMPLE_AI_DECISION.id,
      );
      expect(auditLog.create).not.toHaveBeenCalled();
      expect(aiClient.chatCompletion).not.toHaveBeenCalled();
    });
  });
});
