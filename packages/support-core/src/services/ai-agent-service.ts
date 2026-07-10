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
  AiSettings,
  Message,
  ChatMessage,
} from '../types/index.js';
import { parseAiDecision } from './ai-decision-parser.js';
import { LowConfidenceRule } from './escalation-rules.js';
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

  async processMessage(conversationId: string, orgId: string): Promise<AiDecision> {
    // 1. Load AI settings
    const settings = await this.aiSettingsRepo.findByOrg(orgId);
    const aiMode = settings?.aiMode ?? DEFAULT_AI_SETTINGS.aiMode;
    const confidenceThreshold = settings?.confidenceThreshold ?? DEFAULT_AI_SETTINGS.confidenceThreshold;
    const contextWindowSize = settings?.contextWindowSize ?? DEFAULT_AI_SETTINGS.contextWindowSize;
    const maxConsecutiveFailures = settings?.maxConsecutiveFailures ?? DEFAULT_AI_SETTINGS.maxConsecutiveFailures;
    const knowledgeSimilarityThreshold = settings?.knowledgeSimilarityThreshold ?? DEFAULT_AI_SETTINGS.knowledgeSimilarityThreshold;
    const model = settings?.model ?? DEFAULT_AI_SETTINGS.model;
    const systemPrompt = settings?.systemPrompt ?? DEFAULT_AI_SETTINGS.systemPrompt;

    // If mode is "off", skip processing entirely
    if (aiMode === 'off') {
      const skipDecision = await this.aiDecisionRepo.create({
        conversationId,
        organizationId: orgId,
        decisionType: 'respond',
        confidence: 0,
        reasoningSummary: 'AI processing is disabled for this organization',
        responseText: null,
        tags: [],
        requiresHuman: false,
        rawResponse: null,
      });

      await this.auditLog.create({
        organizationId: orgId,
        actorType: 'ai',
        action: 'ai_decision_produced',
        resourceType: 'ai_decision',
        resourceId: skipDecision.id,
        metadata: { reason: 'ai_mode_off' },
      });

      return skipDecision;
    }

    // 2. Load conversation and history
    const conversation = await this.conversationRepo.findById(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    // Set ai_state to "thinking"
    await this.conversationRepo.update(conversationId, { aiState: 'thinking' });

    const messages = await this.messageRepo.listByConversation(
      conversationId,
      contextWindowSize,
    );

    const latestMessage = messages.length > 0
      ? messages[messages.length - 1].body
      : '';

    const latestMessageRecord = messages.length > 0
      ? messages[messages.length - 1]
      : null;

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
    const citedChunkIds: ReadonlyArray<string> = knowledgeChunks
      .map((c) => c.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

    /** Enqueue a record_chunk_refs job for a freshly-created decision.
     *  Empty arrays are a no-op. A failure here aborts the current job so the
     *  queue can retry instead of silently losing the linked-conversation row. */
    const enqueueChunkRefs = async (decisionId: string): Promise<void> => {
      if (citedChunkIds.length === 0) return;
      await this.jobQueue.enqueue(
        'record_chunk_refs',
        {
          ai_decision_id: decisionId,
          knowledge_chunk_ids: citedChunkIds as string[],
        },
        orgId,
      );
    };

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
    const consecutiveAiFailures = this.countConsecutiveFailures(messages, conversation.aiState);

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
      await this.conversationRepo.update(conversationId, {
        status: 'escalated',
        aiState: 'needs_human',
      });

      const escalateDecision = await this.aiDecisionRepo.create({
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
      });
      await enqueueChunkRefs(escalateDecision.id);

      await this.auditLog.create({
        organizationId: orgId,
        actorType: 'ai',
        action: 'ai_decision_produced',
        resourceType: 'ai_decision',
        resourceId: escalateDecision.id,
        metadata: {
          decisionType: 'escalate',
          ruleName: escalationResult.ruleName,
          reason: escalationResult.reason,
        },
      });

      return escalateDecision;
    }

    // 6. No escalation: call LLM. Keep the error boundary narrow so
    // persistence, queue, and audit failures are not mislabeled as LLM errors.
    const chatMessages = this.buildPrompt(
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
      await this.conversationRepo.update(conversationId, { aiState: 'failed' });

      const errorMessage = err instanceof Error ? err.message : String(err);
      const failedDecision = await this.aiDecisionRepo.create({
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
      });
      await enqueueChunkRefs(failedDecision.id);

      await this.auditLog.create({
        organizationId: orgId,
        actorType: 'ai',
        action: 'ai_decision_produced',
        resourceType: 'ai_decision',
        resourceId: failedDecision.id,
        metadata: { decisionType: 'respond', error: errorMessage },
      });

      return failedDecision;
    }

    const parseResult = parseAiDecision(llmResponse.content);

    if (!parseResult.success) {
      // LLM returned invalid JSON — set ai_state to "failed"
      await this.conversationRepo.update(conversationId, { aiState: 'failed' });

      const failedDecision = await this.aiDecisionRepo.create({
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
      });
      await enqueueChunkRefs(failedDecision.id);

      await this.auditLog.create({
        organizationId: orgId,
        actorType: 'ai',
        action: 'ai_decision_produced',
        resourceType: 'ai_decision',
        resourceId: failedDecision.id,
        metadata: { decisionType: 'respond', error: parseResult.error },
      });

      return failedDecision;
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
      await this.conversationRepo.update(conversationId, {
        status: 'escalated',
        aiState: 'needs_human',
      });

      const lowConfDecision = await this.aiDecisionRepo.create({
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
      });
      await enqueueChunkRefs(lowConfDecision.id);

      await this.auditLog.create({
        organizationId: orgId,
        actorType: 'ai',
        action: 'ai_decision_produced',
        resourceType: 'ai_decision',
        resourceId: lowConfDecision.id,
        metadata: { decisionType: 'escalate', reason: 'low_confidence' },
      });

      return lowConfDecision;
    }

    // 7. Handle mode gating
    if (parsed.requires_human || parsed.decision_type === 'escalate') {
      // LLM itself says escalation needed
      await this.conversationRepo.update(conversationId, {
        status: 'escalated',
        aiState: 'needs_human',
      });

      const humanDecision = await this.aiDecisionRepo.create({
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
      });
      await enqueueChunkRefs(humanDecision.id);

      await this.auditLog.create({
        organizationId: orgId,
        actorType: 'ai',
        action: 'ai_decision_produced',
        resourceType: 'ai_decision',
        resourceId: humanDecision.id,
        metadata: { decisionType: parsed.decision_type, requiresHuman: true },
      });

      return humanDecision;
    }

    if (aiMode === 'draft_only') {
      // Store draft, don't send
      await this.conversationRepo.update(conversationId, { aiState: 'drafted' });

      const draftDecision = await this.aiDecisionRepo.create({
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
      });
      await enqueueChunkRefs(draftDecision.id);

      await this.auditLog.create({
        organizationId: orgId,
        actorType: 'ai',
        action: 'ai_decision_produced',
        resourceType: 'ai_decision',
        resourceId: draftDecision.id,
        metadata: { decisionType: parsed.decision_type, mode: 'draft_only' },
      });

      return draftDecision;
    }

    if (aiMode === 'auto_reply') {
      // Auto-send if confidence ≥ threshold and requires_human is false
      if (parsed.confidence >= confidenceThreshold && !parsed.requires_human) {
        // Auto-reply: enqueue outbound message job
        await this.conversationRepo.update(conversationId, { aiState: 'auto_replied' });

        const autoDecision = await this.aiDecisionRepo.create({
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
        });
        await enqueueChunkRefs(autoDecision.id);

        await this.auditLog.create({
          organizationId: orgId,
          actorType: 'ai',
          action: 'ai_decision_produced',
          resourceType: 'ai_decision',
          resourceId: autoDecision.id,
          metadata: { decisionType: parsed.decision_type, mode: 'auto_reply', autoSent: true },
        });

        return autoDecision;
      } else {
        // Confidence below threshold in auto_reply mode — store as draft
        await this.conversationRepo.update(conversationId, { aiState: 'drafted' });

        const draftDecision = await this.aiDecisionRepo.create({
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
        });
        await enqueueChunkRefs(draftDecision.id);

        await this.auditLog.create({
          organizationId: orgId,
          actorType: 'ai',
          action: 'ai_decision_produced',
          resourceType: 'ai_decision',
          resourceId: draftDecision.id,
          metadata: {
            decisionType: parsed.decision_type,
            mode: 'auto_reply',
            autoSent: false,
            reason: 'confidence_below_threshold',
          },
        });

        return draftDecision;
      }
    }

    // Fallback: store as draft
    await this.conversationRepo.update(conversationId, { aiState: 'drafted' });

    const fallbackDecision = await this.aiDecisionRepo.create({
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
    });
    await enqueueChunkRefs(fallbackDecision.id);

    await this.auditLog.create({
      organizationId: orgId,
      actorType: 'ai',
      action: 'ai_decision_produced',
      resourceType: 'ai_decision',
      resourceId: fallbackDecision.id,
      metadata: { decisionType: parsed.decision_type },
    });

    return fallbackDecision;
  }

  // ─── Private Helpers ────────────────────────────────────────────────

  /**
   * Count consecutive AI failures by looking at the conversation's current ai_state.
   * A simple heuristic: if ai_state is "failed", count it as 1 failure.
   * In a production system, this would query recent AI decisions.
   */
  private countConsecutiveFailures(messages: Message[], currentAiState: string): number {
    if (currentAiState === 'failed') {
      return 1;
    }
    return 0;
  }

  /**
   * Build the LLM prompt from conversation history and knowledge chunks.
   */
  private buildPrompt(
    messages: Message[],
    knowledgeChunks: Array<{ content: string }>,
    systemPrompt: string | null,
  ): ChatMessage[] {
    const chatMessages: ChatMessage[] = [];

    // System prompt
    const baseSystemPrompt = systemPrompt ??
      'You are a helpful customer support AI assistant. Analyze the conversation and provide a structured response.';

    let fullSystemPrompt = baseSystemPrompt;

    // Add knowledge context if available
    if (knowledgeChunks.length > 0) {
      const knowledgeContext = knowledgeChunks
        .map((chunk, i) => `[Knowledge ${i + 1}]: ${chunk.content}`)
        .join('\n\n');

      fullSystemPrompt += `\n\nRelevant knowledge base articles:\n${knowledgeContext}`;
    } else {
      fullSystemPrompt += `\n\nNo relevant knowledge base article was found for this message. Do not invent facts, policies, prices, timelines, or account-specific details. If you cannot answer safely from the conversation alone, return decision_type "clarify", requires_human false, and a concise response_text that asks the customer for the missing detail or explains that you need more information. Do not escalate solely because knowledge is missing.`;
    }

    fullSystemPrompt += `\n\nYou MUST respond with a JSON object in this exact format:
{
  "decision_type": "respond" | "escalate" | "clarify",
  "confidence": 0.0 to 1.0,
  "reasoning_summary": "brief explanation of your reasoning",
  "response_text": "your response to the customer" or null,
  "tags": ["relevant", "tags"],
  "requires_human": true or false
}`;

    chatMessages.push({ role: 'system', content: fullSystemPrompt });

    // Conversation history
    for (const msg of messages) {
      const role: 'user' | 'assistant' =
        msg.senderType === 'contact' ? 'user' : 'assistant';
      chatMessages.push({ role, content: msg.body });
    }

    return chatMessages;
  }
}
