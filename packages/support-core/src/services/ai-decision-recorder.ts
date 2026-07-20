import type {
  AiDecisionRepository,
  AiTurnFinalization,
} from '../repositories/ai-decision-repository.js';
import type { AuditLogRepository } from '../repositories/audit-log-repository.js';
import type { JobQueue } from '../interfaces/job-queue.js';
import type { AiDecision, CreateAiDecisionInput } from '../types/index.js';

/**
 * Owns the durable tail of an AI turn: one decision per source job, grounding
 * reference enqueue, and audit creation. Keeping this sequence in one place
 * prevents individual decision branches from drifting or changing retry order.
 */
export class AiDecisionRecorder {
  private groundingChunkIds: ReadonlyArray<string> = [];

  constructor(
    private aiDecisionRepo: AiDecisionRepository,
    private jobQueue: JobQueue,
    private auditLog: AuditLogRepository,
    private organizationId: string,
    private sourceJobId?: string,
  ) {}

  setGroundingChunkIds(chunkIds: ReadonlyArray<string>): void {
    this.groundingChunkIds = [...chunkIds];
  }

  /** Resume downstream work for a decision already persisted by this job. */
  async recover(conversationId: string): Promise<AiDecision | null> {
    if (!this.sourceJobId) return null;

    const existingDecision = await this.aiDecisionRepo.findBySourceJobId(
      this.sourceJobId,
      this.organizationId,
    );
    if (!existingDecision) return null;
    if (existingDecision.conversationId !== conversationId) {
      throw new Error(
        `AI decision source job ${this.sourceJobId} belongs to a different conversation`,
      );
    }

    const storedChunkIds = existingDecision.rawResponse?._groundingChunkIds;
    const retryChunkIds = Array.isArray(storedChunkIds)
      ? storedChunkIds.filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      )
      : [];
    await this.enqueueChunkRefs(existingDecision.id, retryChunkIds);
    const auditExists = await this.auditLog.existsForActionResource(
      this.organizationId,
      'ai_decision_produced',
      'ai_decision',
      existingDecision.id,
    );
    if (!auditExists) {
      const storedAuditMetadata = existingDecision.rawResponse?._auditMetadata;
      const auditMetadata = storedAuditMetadata &&
          typeof storedAuditMetadata === 'object' &&
          !Array.isArray(storedAuditMetadata)
        ? storedAuditMetadata as Record<string, unknown>
        : { recoveredFromSourceJob: true };
      await this.auditLog.create({
        organizationId: this.organizationId,
        actorType: 'ai',
        action: 'ai_decision_produced',
        resourceType: 'ai_decision',
        resourceId: existingDecision.id,
        metadata: auditMetadata,
      });
    }
    return existingDecision;
  }

  async record(
    input: CreateAiDecisionInput,
    auditMetadata: Record<string, unknown>,
    finalization: AiTurnFinalization,
  ): Promise<AiDecision | null> {
    const persistedInput = this.sourceJobId
      ? {
          ...input,
          sourceJobId: this.sourceJobId,
          rawResponse: {
            ...(input.rawResponse ?? {}),
            _groundingChunkIds: [...this.groundingChunkIds],
            _auditMetadata: auditMetadata,
            _shouldAutoSend: auditMetadata.autoSent === true,
          },
        }
      : input;
    const decision = await this.aiDecisionRepo.finalizeTurn(
      persistedInput,
      finalization,
    );
    if (!decision) return null;

    await this.enqueueChunkRefs(decision.id, this.groundingChunkIds);
    await this.auditLog.create({
      organizationId: this.organizationId,
      actorType: 'ai',
      action: 'ai_decision_produced',
      resourceType: 'ai_decision',
      resourceId: decision.id,
      metadata: auditMetadata,
    });
    return decision;
  }

  private async enqueueChunkRefs(
    decisionId: string,
    chunkIds: ReadonlyArray<string>,
  ): Promise<void> {
    if (chunkIds.length === 0) return;
    await this.jobQueue.enqueue(
      'record_chunk_refs',
      {
        ai_decision_id: decisionId,
        knowledge_chunk_ids: [...chunkIds],
      },
      this.organizationId,
    );
  }
}
