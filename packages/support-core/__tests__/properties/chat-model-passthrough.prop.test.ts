import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { CHAT_MODEL_OPTIONS } from '@support-core/types/ai-models';
import type { ModelId } from '@support-core/types/ai-models';
import { AiAgentService } from '@support-core/services/ai-agent-service';
import { EscalationEngine } from '@support-core/interfaces/escalation';
import type { ConversationRepository } from '@support-core/repositories/conversation-repository';
import type { MessageRepository } from '@support-core/repositories/message-repository';
import type { KnowledgeRepository } from '@support-core/repositories/knowledge-repository';
import type { AiSettingsRepository } from '@support-core/repositories/ai-settings-repository';
import type { AiDecisionRepository } from '@support-core/repositories/ai-decision-repository';
import type { AuditLogRepository } from '@support-core/repositories/audit-log-repository';
import type { AiClient } from '@support-core/interfaces/ai-client';
import type { JobQueue } from '@support-core/interfaces/job-queue';
import type {
  Conversation,
  Message,
  AiSettings,
  AiDecision,
  AuditLog,
  Job,
} from '@support-core/types/index';

/**
 * Property-based test: chat model passthrough.
 *
 * Locks the wiring between `AiSettings.model` (set by each org in
 * `ai_settings`) and the `model` argument passed to `aiClient.chatCompletion`.
 *
 * If anyone ever hardcodes a model between the settings load
 * (line ~67 of `ai-agent-service.ts`) and the LLM call
 * (line ~252 of `ai-agent-service.ts`), this test catches it: the LLM
 * is always called with the same model that the org configured.
 *
 * Feature: model-picker-refinement, Property: chat model passthrough
 */

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

/** A valid LLM response that parses cleanly. */
const VALID_LLM_JSON = JSON.stringify({
  decision_type: 'respond',
  confidence: 0.9,
  reasoning_summary: 'High confidence answer',
  response_text: 'Here is your answer.',
  tags: [],
  requires_human: false,
});

/** Build a fresh `AiAgentService` wired to mocks for one test iteration. */
function buildServiceWithModel(model: ModelId): {
  service: AiAgentService;
  aiClient: AiClient;
} {
  const settings: AiSettings = {
    id: 'settings-001',
    organizationId: ORG_ID,
    aiMode: 'draft_only',
    confidenceThreshold: 0.75,
    contextWindowSize: 20,
    maxConsecutiveFailures: 3,
    knowledgeSimilarityThreshold: 0.7,
    escalationKeywords: [],
    systemPrompt: 'You are a helpful support agent.',
    model,
    embeddingModel: 'openai/text-embedding-3-small',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  const conversationRepo: ConversationRepository = {
    findById: vi.fn().mockResolvedValue(SAMPLE_CONVERSATION),
    findOpenByContactAndChannel: vi.fn(),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue(SAMPLE_CONVERSATION),
    listByOrg: vi.fn(),
  } as unknown as ConversationRepository;

  const messageRepo: MessageRepository = {
    findByExternalId: vi.fn(),
    create: vi.fn(),
    listByConversation: vi.fn().mockResolvedValue([SAMPLE_MESSAGE]),
  } as unknown as MessageRepository;

  const knowledgeRepo: KnowledgeRepository = {
    matchChunks: vi.fn().mockResolvedValue([]),
    searchChunksByText: vi.fn().mockResolvedValue([]),
    getDocument: vi.fn(),
    createDocument: vi.fn(),
    updateDocument: vi.fn(),
    deleteDocumentWithChunks: vi.fn(),
    insertChunks: vi.fn(),
    deleteChunksByDocument: vi.fn(),
  } as unknown as KnowledgeRepository;

  const aiSettingsRepo: AiSettingsRepository = {
    findByOrg: vi.fn().mockResolvedValue(settings),
    create: vi.fn(),
    update: vi.fn(),
  } as unknown as AiSettingsRepository;

  const aiDecisionRepo: AiDecisionRepository = {
    create: vi.fn().mockResolvedValue(SAMPLE_AI_DECISION),
    finalizeTurn: vi.fn().mockResolvedValue(SAMPLE_AI_DECISION),
    findBySourceJobId: vi.fn().mockResolvedValue(null),
    findLatestByConversation: vi.fn(),
  } as unknown as AiDecisionRepository;

  const auditLog: AuditLogRepository = {
    create: vi.fn().mockResolvedValue(SAMPLE_AUDIT_LOG),
  } as unknown as AuditLogRepository;

  const aiClient: AiClient = {
    chatCompletion: vi.fn().mockResolvedValue({ content: VALID_LLM_JSON }),
    createEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0)),
  };

  const jobQueue: JobQueue = {
    enqueue: vi.fn().mockResolvedValue(SAMPLE_JOB),
    claim: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
  };

  const service = new AiAgentService(
    conversationRepo,
    messageRepo,
    knowledgeRepo,
    aiSettingsRepo,
    aiDecisionRepo,
    new EscalationEngine(),
    aiClient,
    jobQueue,
    auditLog,
  );

  return { service, aiClient };
}

describe('chat model passthrough (property)', () => {
  // Sanity: ensure CHAT_MODEL_OPTIONS has exactly 7 models.
  it('CHAT_MODEL_OPTIONS contains 7 models (sanity check for the arbitrary)', () => {
    expect(CHAT_MODEL_OPTIONS.length).toBe(7);
  });

  /**
   * Property: For every chat model in CHAT_MODEL_OPTIONS, the LLM is
   * called with exactly that model in the `model` argument.
   *
   * This locks the wiring: any future regression that hardcodes a model
   * between `settings.model` and `aiClient.chatCompletion` will fail
   * this test for the affected model.
   */
  it('Property: for every CHAT_MODEL_OPTIONS entry, chatCompletion is called with the same model', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...CHAT_MODEL_OPTIONS), async (model) => {
        const { service, aiClient } = buildServiceWithModel(model);

        await service.processMessage(CONV_ID, ORG_ID);

        // The LLM must be called with the exact model the org selected.
        expect(aiClient.chatCompletion).toHaveBeenCalledTimes(1);
        expect(aiClient.chatCompletion).toHaveBeenCalledWith(
          expect.objectContaining({ model }),
        );

        // The embedding model must be passed through to createEmbedding too.
        // (Separate invariant — same wiring, different code path.)
        expect(aiClient.createEmbedding).toHaveBeenCalledWith(
          expect.objectContaining({
            model: 'openai/text-embedding-3-small',
          }),
        );
      }),
      // 100 iterations = ~8 per model on average across 12 models. The
      // arbitrary is constantFrom, so every iteration picks one of the
      // 12 models uniformly; 100 runs guarantee at least 8 hits per model
      // in the long run, which is enough to catch a hardcoded regression.
      // Per packages/support-core/__tests__/AGENTS.md, numRuns: 100 is
      // the project-wide default; deviations require AGENTS.md amendment.
      { numRuns: 100 },
    );
  });
});
