/**
 * AiAgentService — orchestrates AI message processing.
 *
 * Flow:
 * 1. Load AI settings — if mode is "off", skip processing
 * 2. Load conversation history (up to context window)
 * 3. Get matching knowledge chunks for the latest message
 * 4. Evaluate escalation engine BEFORE LLM call
 * 5. If escalation: skip LLM, set ai_state to "needs_human", status to "escalated"
 * 6. If no escalation: call LLM, parse response as AI_Decision
 * 7. Handle mode gating: "draft_only" stores draft, "auto_reply" sends if confidence ≥ threshold
 * 8. Record audit log
 */

import type { ConversationRepository } from '../repositories/conversation-repository.js';
import type { MessageRepository } from '../repositories/message-repository.js';
import type { KnowledgeRepository } from '../repositories/knowledge-repository.js';
import type { AiSettingsRepository } from '../repositories/ai-settings-repository.js';
import type { AiDecisionRepository } from '../repositories/ai-decision-repository.js';
import type { AuditLogRepository } from '../repositories/audit-log-repository.js';
import type { EscalationEngine } from '../interfaces/escalation.js';
import type { AiClient } from '../interfaces/ai-client.js';
import type { JobQueue } from '../interfaces/job-queue.js';
import type {
  AiDecision,
  AiState,
  AiSettings,
  ConversationStatus,
  Message,
} from '../types/index.js';
import { parseAiDecision } from './ai-decision-parser.js';
import { LowConfidenceRule } from './escalation-rules.js';
import { AiDecisionRecorder } from './ai-decision-recorder.js';
import { buildAiPrompt } from './ai-prompt-builder.js';
import { DEFAULT_CHAT_MODEL, DEFAULT_EMBEDDING_MODEL } from '../types/ai-models.js';

/** Default AI settings used when no settings are configured for the org. */
const DEFAULT_AI_SETTINGS: Omit<AiSettings, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'> = {
  aiMode: 'draft_only',
  confidenceThreshold: 0.75,
  contextWindowSize: 20,
  maxConsecutiveFailures: 3,
  knowledgeSimilarityThreshold: 0.7,
  escalationKeywords: [],
  systemPrompt: null,
  model: DEFAULT_CHAT_MODEL,
  embeddingModel: 'openai/text-embedding-3-small',
};

interface AiTurnTransition {
  aiState: AiState;
  status?: ConversationStatus;
}

/** Reconstruct the already-claimed final state when a persisted job retries. */
export function transitionForRecoveredDecision(
  decision: Pick<AiDecision, 'requiresHuman' | 'responseText' | 'rawResponse'>,
): AiTurnTransition {
  if (decision.requiresHuman) {
    return { aiState: 'needs_human', status: 'escalated' };
  }
  if (decision.rawResponse?._shouldAutoSend === true) {
    return { aiState: 'auto_replied' };
  }
  if (decision.responseText) {
    return { aiState: 'drafted' };
  }

  const auditMetadata = decision.rawResponse?._auditMetadata;
  if (
    auditMetadata &&
    typeof auditMetadata === 'object' &&
    !Array.isArray(auditMetadata) &&
    'reason' in auditMetadata &&
    auditMetadata.reason === 'ai_mode_off'
  ) {
    return { aiState: 'idle' };
  }
  return { aiState: 'failed' };
}

export class AiAgentService {
  constructor(
    private conversationRepo: ConversationRepository,
    private messageRepo: MessageRepository,
    private knowledgeRepo: KnowledgeRepository,
    private aiSettingsRepo: AiSettingsRepository,
    private aiDecisionRepo: AiDecisionRepository,
    private escalationEngine: EscalationEngine,
    private aiClient: AiClient,
    private jobQueue: JobQueue,
    private auditLog: AuditLogRepository,
  ) {}

  async processMessage(
    conversationId: string,
    orgId: string,
    options: { sourceJobId?: string; sourceMessageId?: string } = {},
  ): Promise<AiDecision | null> {
    const decisionRecorder = new AiDecisionRecorder(
      this.aiDecisionRepo,
      this.jobQueue,
      this.auditLog,
      orgId,
      options.sourceJobId,
    );

    // 1. Load AI settings
    const settings = await this.aiSettingsRepo.findByOrg(orgId);
    const aiMode = settings?.aiMode ?? DEFAULT_AI_SETTINGS.aiMode;
    const confidenceThreshold = settings?.confidenceThreshold ?? DEFAULT_AI_SETTINGS.confidenceThreshold;
    const contextWindowSize = settings?.contextWindowSize ?? DEFAULT_AI_SETTINGS.contextWindowSize;
    const knowledgeSimilarityThreshold = settings?.knowledgeSimilarityThreshold ?? DEFAULT_AI_SETTINGS.knowledgeSimilarityThreshold;
    const model = settings?.model ?? DEFAULT_AI_SETTINGS.model;
    const systemPrompt = settings?.systemPrompt ?? DEFAULT_AI_SETTINGS.systemPrompt;

    // 2. Load conversation and history
    const conversation = await this.conversationRepo.findById(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }
    if (conversation.organizationId !== orgId) {
      throw new Error(`Conversation ${conversationId} belongs to a different organization`);
    }

    let sourceMessage: Message | null = null;
    if (options.sourceMessageId) {
      sourceMessage = await this.messageRepo.findById(options.sourceMessageId);
      if (!sourceMessage) {
        throw new Error(`Source message not found: ${options.sourceMessageId}`);
      }
      if (
        sourceMessage.conversationId !== conversationId ||
        sourceMessage.direction !== 'inbound' ||
        sourceMessage.senderType !== 'contact'
      ) {
        throw new Error('AI source message is not an inbound contact message for this conversation');
      }
    }

    const finalizationFor = (transition: AiTurnTransition) => ({
      sourceMessageId: sourceMessage?.id ?? null,
      ...transition,
      expected: sourceMessage
        ? { aiState: 'thinking' as const, status: 'open' as const }
        : undefined,
    });

    // A worker retry after decision persistence must resume downstream work,
    // not call the LLM and create another decision. Source validation happens
    // first so an old decision cannot be resumed after a newer customer or
    // human turn superseded it.
    const existingDecision = await decisionRecorder.recover(conversationId);
    if (existingDecision) {
      const recoveredTransition = transitionForRecoveredDecision(existingDecision);
      if (
        sourceMessage &&
        !await this.transitionAiTurn(
          conversationId,
          orgId,
          sourceMessage.id,
          recoveredTransition,
          {
            aiState: recoveredTransition.aiState,
            status: recoveredTransition.status ?? 'open',
          },
        )
      ) {
        return null;
      }
      return existingDecision;
    }

    if (
      sourceMessage &&
      !await this.transitionAiTurn(
        conversationId,
        orgId,
        sourceMessage.id,
        { aiState: 'thinking' },
        { status: 'open' },
      )
    ) {
      return null;
    }

    // If mode is "off", skip processing entirely.
    if (aiMode === 'off') {
      return decisionRecorder.record({
        conversationId,
        organizationId: orgId,
        messageId: sourceMessage?.id ?? null,
        decisionType: 'respond',
        confidence: 0,
        reasoningSummary: 'AI processing is disabled for this organization',
        responseText: null,
        tags: [],
        requiresHuman: false,
        rawResponse: null,
      }, { reason: 'ai_mode_off' }, finalizationFor({ aiState: 'idle' }));
    }

    // Source-bound workers already claimed `thinking` atomically above.
    if (!sourceMessage) {
      await this.conversationRepo.update(conversationId, { aiState: 'thinking' });
    }

    const messages = sourceMessage
      ? await this.messageRepo.listByConversationThroughMessage(
          conversationId,
          sourceMessage,
          contextWindowSize,
        )
      : await this.messageRepo.listByConversation(conversationId, contextWindowSize);

    const latestMessage = messages.length > 0
      ? messages[messages.length - 1].body
      : '';

    const latestMessageRecord = sourceMessage ?? (
      messages.length > 0 ? messages[messages.length - 1] : null
    );

    // 3. Get matching knowledge chunks
    let knowledgeChunks: Awaited<ReturnType<KnowledgeRepository['matchChunks']>> = [];
    try {
      // Generate embedding for the latest message
      const embedding = await this.aiClient.createEmbedding({
        model: settings?.embeddingModel ?? DEFAULT_EMBEDDING_MODEL,
        input: latestMessage,
      });

      knowledgeChunks = await this.knowledgeRepo.matchChunks(
        embedding,
        orgId,
        5,
        knowledgeSimilarityThreshold,
      );
    } catch (err) {
      // If embedding/vector retrieval fails, try lexical fallback below before
      // falling back to the no-knowledge clarification policy.
      console.warn(
        'embedding/knowledge retrieval failed; continuing with empty chunks',
        err instanceof Error ? err.message : String(err),
      );
    }

    if (knowledgeChunks.length === 0 && latestMessage.trim().length > 0) {
      try {
        knowledgeChunks = await this.knowledgeRepo.searchChunksByText(
          orgId,
          latestMessage,
          5,
        );
      } catch (err) {
        // A failed fallback should not hide the original AI turn. If both
        // retrieval paths miss, the prompt tells the model to clarify instead
        // of inventing an ungrounded answer.
        console.warn(
          'lexical knowledge retrieval failed; continuing with empty chunks',
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // Chunk IDs that grounded this turn. Enqueued (not inserted inline)
    // after each ai_decisions insert so the /knowledge/[id] page can show
    // "Linked conversations" that actually cited this document.
    //
    // The enqueue is awaited, so the durable job row is committed in the
    // same transactional path as the decision. A separate process-jobs
    // worker picks up the record_chunk_refs job and does the actual
    // insert. This survives serverless function freeze-on-return, which
    // an inline DB write from a detached promise would not.
    const citedChunkIds = knowledgeChunks
      .map((c) => c.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    decisionRecorder.setGroundingChunkIds(citedChunkIds);

    // Build effective settings for escalation context.
    // Explicit construction (no `as` cast) so missing fields are compile-time
    // visible: the cast used to mask `embeddingModel` until T6 added it.
    const effectiveSettings: AiSettings = settings ?? {
      id: '',
      organizationId: orgId,
      aiMode: DEFAULT_AI_SETTINGS.aiMode,
      confidenceThreshold: DEFAULT_AI_SETTINGS.confidenceThreshold,
      contextWindowSize: DEFAULT_AI_SETTINGS.contextWindowSize,
      maxConsecutiveFailures: DEFAULT_AI_SETTINGS.maxConsecutiveFailures,
      knowledgeSimilarityThreshold: DEFAULT_AI_SETTINGS.knowledgeSimilarityThreshold,
      escalationKeywords: DEFAULT_AI_SETTINGS.escalationKeywords,
      systemPrompt: DEFAULT_AI_SETTINGS.systemPrompt,
      model: DEFAULT_AI_SETTINGS.model,
      embeddingModel: DEFAULT_AI_SETTINGS.embeddingModel,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Count consecutive AI failures from recent decisions
    const consecutiveAiFailures = conversation.aiState === 'failed' ? 1 : 0;

    // 4. Evaluate escalation engine BEFORE LLM call
    const escalationResult = this.escalationEngine.evaluate({
      latestMessage,
      conversationHistory: messages,
      knowledgeChunks: knowledgeChunks.map((c) => ({
        id: c.id,
        documentId: c.documentId ?? '',
        organizationId: orgId,
        content: c.content,
        embedding: [],
        metadata: c.metadata ?? {},
        createdAt: new Date(),
      })),
      knowledgeSimilarityThreshold,
      aiSettings: effectiveSettings,
      consecutiveAiFailures,
    });

    // 5. If escalation: skip LLM
    if (escalationResult) {
      return decisionRecorder.record({
        conversationId,
        organizationId: orgId,
        messageId: latestMessageRecord?.id ?? null,
        decisionType: 'escalate',
        confidence: 0,
        reasoningSummary: `Escalated by ${escalationResult.ruleName}: ${escalationResult.reason}`,
        responseText: null,
        tags: ['escalated'],
        requiresHuman: true,
        rawResponse: { escalationRule: escalationResult.ruleName, reason: escalationResult.reason },
      }, {
        decisionType: 'escalate',
        ruleName: escalationResult.ruleName,
        reason: escalationResult.reason,
      }, finalizationFor({ status: 'escalated', aiState: 'needs_human' }));
    }

    // 6. No escalation: call LLM. Keep the error boundary narrow so
    // persistence, queue, and audit failures are not mislabeled as LLM errors.
    const chatMessages = buildAiPrompt(
      messages,
      knowledgeChunks,
      systemPrompt,
    );

    let llmResponse: Awaited<ReturnType<AiClient['chatCompletion']>>;
    try {
      llmResponse = await this.aiClient.chatCompletion({
        model,
        messages: chatMessages,
        responseFormat: { type: 'json_object' },
        temperature: 0.3,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return decisionRecorder.record({
        conversationId,
        organizationId: orgId,
        messageId: latestMessageRecord?.id ?? null,
        decisionType: 'respond',
        confidence: 0,
        reasoningSummary: `AI processing failed: ${errorMessage}`,
        responseText: null,
        tags: ['error'],
        requiresHuman: false,
        rawResponse: { error: errorMessage },
      }, { decisionType: 'respond', error: errorMessage }, finalizationFor({ aiState: 'failed' }));
    }

    const parseResult = parseAiDecision(llmResponse.content);

    if (!parseResult.success) {
      // LLM returned invalid JSON — set ai_state to "failed"
      return decisionRecorder.record({
        conversationId,
        organizationId: orgId,
        messageId: latestMessageRecord?.id ?? null,
        decisionType: 'respond',
        confidence: 0,
        reasoningSummary: `AI response parsing failed: ${parseResult.error}`,
        responseText: null,
        tags: ['parse_error'],
        requiresHuman: false,
        rawResponse: { raw: llmResponse.content, error: parseResult.error },
      }, { decisionType: 'respond', error: parseResult.error }, finalizationFor({ aiState: 'failed' }));
    }

    const parsed = parseResult.data;

    // Check post-LLM low confidence escalation
    const lowConfidenceRule = new LowConfidenceRule();
    const lowConfResult = lowConfidenceRule.evaluateConfidence(
      parsed.confidence,
      confidenceThreshold,
    );

    if (
      lowConfResult &&
      parsed.decision_type !== 'escalate' &&
      parsed.decision_type !== 'clarify'
    ) {
      // Low confidence — escalate
      return decisionRecorder.record({
        conversationId,
        organizationId: orgId,
        messageId: latestMessageRecord?.id ?? null,
        decisionType: 'escalate',
        confidence: parsed.confidence,
        reasoningSummary: `Low confidence (${parsed.confidence} < ${confidenceThreshold}): ${parsed.reasoning_summary}`,
        responseText: parsed.response_text,
        tags: [...parsed.tags, 'low_confidence'],
        requiresHuman: true,
        rawResponse: parsed as unknown as Record<string, unknown>,
      }, { decisionType: 'escalate', reason: 'low_confidence' }, finalizationFor({
        status: 'escalated',
        aiState: 'needs_human',
      }));
    }

    // 7. Handle mode gating
    if (parsed.requires_human || parsed.decision_type === 'escalate') {
      // LLM itself says escalation needed
      return decisionRecorder.record({
        conversationId,
        organizationId: orgId,
        messageId: latestMessageRecord?.id ?? null,
        decisionType: parsed.decision_type as 'respond' | 'escalate' | 'clarify',
        confidence: parsed.confidence,
        reasoningSummary: parsed.reasoning_summary,
        responseText: parsed.response_text,
        tags: parsed.tags,
        requiresHuman: true,
        rawResponse: parsed as unknown as Record<string, unknown>,
      }, { decisionType: parsed.decision_type, requiresHuman: true }, finalizationFor({
        status: 'escalated',
        aiState: 'needs_human',
      }));
    }

    if (aiMode === 'draft_only') {
      // Store draft, don't send
      return decisionRecorder.record({
        conversationId,
        organizationId: orgId,
        messageId: latestMessageRecord?.id ?? null,
        decisionType: parsed.decision_type as 'respond' | 'escalate' | 'clarify',
        confidence: parsed.confidence,
        reasoningSummary: parsed.reasoning_summary,
        responseText: parsed.response_text,
        tags: parsed.tags,
        requiresHuman: false,
        rawResponse: parsed as unknown as Record<string, unknown>,
      }, { decisionType: parsed.decision_type, mode: 'draft_only' }, finalizationFor({
        aiState: 'drafted',
      }));
    }

    if (aiMode === 'auto_reply') {
      // Auto-send if confidence ≥ threshold and requires_human is false
      if (parsed.confidence >= confidenceThreshold && !parsed.requires_human) {
        // The atomic decision/final-state commit is the durable reply-intent
        // ordering point. The worker dispatches only after it succeeds.
        return decisionRecorder.record({
          conversationId,
          organizationId: orgId,
          messageId: latestMessageRecord?.id ?? null,
          decisionType: parsed.decision_type as 'respond' | 'escalate' | 'clarify',
          confidence: parsed.confidence,
          reasoningSummary: parsed.reasoning_summary,
          responseText: parsed.response_text,
          tags: parsed.tags,
          requiresHuman: false,
          rawResponse: parsed as unknown as Record<string, unknown>,
        }, { decisionType: parsed.decision_type, mode: 'auto_reply', autoSent: true }, finalizationFor({
          aiState: 'auto_replied',
        }));
      } else {
        // Confidence below threshold in auto_reply mode — store as draft
        return decisionRecorder.record({
          conversationId,
          organizationId: orgId,
          messageId: latestMessageRecord?.id ?? null,
          decisionType: parsed.decision_type as 'respond' | 'escalate' | 'clarify',
          confidence: parsed.confidence,
          reasoningSummary: parsed.reasoning_summary,
          responseText: parsed.response_text,
          tags: parsed.tags,
          requiresHuman: false,
          rawResponse: parsed as unknown as Record<string, unknown>,
        }, {
          decisionType: parsed.decision_type,
          mode: 'auto_reply',
          autoSent: false,
          reason: 'confidence_below_threshold',
        }, finalizationFor({ aiState: 'drafted' }));
      }
    }

    // Fallback: store as draft
    return decisionRecorder.record({
      conversationId,
      organizationId: orgId,
      messageId: latestMessageRecord?.id ?? null,
      decisionType: parsed.decision_type as 'respond' | 'escalate' | 'clarify',
      confidence: parsed.confidence,
      reasoningSummary: parsed.reasoning_summary,
      responseText: parsed.response_text,
      tags: parsed.tags,
      requiresHuman: false,
      rawResponse: parsed as unknown as Record<string, unknown>,
    }, { decisionType: parsed.decision_type }, finalizationFor({ aiState: 'drafted' }));
  }

  private async transitionAiTurn(
    conversationId: string,
    organizationId: string,
    sourceMessageId: string | undefined,
    transition: AiTurnTransition,
    expected?: { aiState?: AiState; status?: ConversationStatus },
  ): Promise<boolean> {
    if (!sourceMessageId) {
      await this.conversationRepo.update(conversationId, {
        aiState: transition.aiState,
        ...(transition.status ? { status: transition.status } : {}),
      });
      return true;
    }

    return this.conversationRepo.transitionAiSourceTurn(
      conversationId,
      organizationId,
      sourceMessageId,
      transition.aiState,
      transition.status,
      expected,
    );
  }

}
