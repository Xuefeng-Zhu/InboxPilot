/**
 * KnowledgeIngestionService — orchestrates document chunking and embedding.
 *
 * Flow:
 * 1. Load the document by ID
 * 2. Set status to "processing"
 * 3. Split body into chunks (paragraph-based, ~500 chars max)
 * 4. Generate embedding for each chunk via AiClient.createEmbedding
 * 5. Store chunks with embeddings
 * 6. Set status to "ready" on success
 * 7. On error: clean up partial chunks, set status to "failed" with error message
 * 8. Record audit log entry
 */

import type { KnowledgeRepository } from '../repositories/knowledge-repository.js';
import type { AiClient } from '../interfaces/ai-client.js';
import type { AuditLogRepository } from '../repositories/audit-log-repository.js';
import type { CreateChunkInput } from '../types/index.js';
import { splitIntoChunks } from '../utils/chunking.js';

export class KnowledgeIngestionService {
  constructor(
    private knowledgeRepo: KnowledgeRepository,
    private aiClient: AiClient,
    private auditLog: AuditLogRepository,
  ) {}

  /**
   * Process a knowledge document: chunk, embed, and store.
   *
   * @param documentId - The ID of the document to process
   */
  async processDocument(documentId: string): Promise<void> {
    // 1. Load the document
    const document = await this.knowledgeRepo.getDocument(documentId);
    if (!document) {
      throw new Error(`Document not found: ${documentId}`);
    }

    try {
      // 2. Set status to "processing"
      await this.knowledgeRepo.updateDocument(documentId, { status: 'processing' });

      // 3. Split body into chunks
      const textChunks = splitIntoChunks(document.body);

      if (textChunks.length === 0) {
        throw new Error('Document body produced no chunks after splitting');
      }

      // 4. Generate embeddings for each chunk
      const chunkInputs: CreateChunkInput[] = [];
      for (const chunkText of textChunks) {
        const embedding = await this.aiClient.createEmbedding({
          model: 'text-embedding-ada-002',
          input: chunkText,
        });

        chunkInputs.push({
          documentId: document.id,
          organizationId: document.organizationId,
          content: chunkText,
          embedding,
          metadata: {},
        });
      }

      // 5. Store all chunks with embeddings
      await this.knowledgeRepo.insertChunks(chunkInputs);

      // 6. Set status to "ready"
      await this.knowledgeRepo.updateDocument(documentId, { status: 'ready' });

      // 8. Record audit log entry for success
      await this.auditLog.create({
        organizationId: document.organizationId,
        actorType: 'system',
        action: 'knowledge_document_processed',
        resourceType: 'knowledge_document',
        resourceId: documentId,
        metadata: { chunkCount: chunkInputs.length, status: 'ready' },
      });
    } catch (err) {
      // 7. On error: clean up partial chunks and set status to "failed"
      try {
        await this.knowledgeRepo.deleteChunksByDocument(documentId);
      } catch {
        // Ignore cleanup errors — the primary error is more important
      }

      const errorMessage = err instanceof Error ? err.message : 'Unknown error';

      try {
        await this.knowledgeRepo.updateDocument(documentId, {
          status: 'failed',
          errorMessage,
        });
      } catch {
        // Ignore status update errors
      }

      // Record audit log entry for failure
      try {
        await this.auditLog.create({
          organizationId: document.organizationId,
          actorType: 'system',
          action: 'knowledge_document_failed',
          resourceType: 'knowledge_document',
          resourceId: documentId,
          metadata: { error: errorMessage, status: 'failed' },
        });
      } catch {
        // Ignore audit log errors
      }

      throw err;
    }
  }
}
