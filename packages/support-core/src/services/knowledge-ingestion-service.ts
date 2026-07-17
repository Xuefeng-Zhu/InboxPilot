/**
 * KnowledgeIngestionService — orchestrates document chunking and embedding.
 *
 * Flow:
 * 1. Load the document by ID
 * 2. Set status to "processing"
 * 3. Gather text content: body text + file content (if file_url is present)
 * 4. Split combined content into chunks (paragraph-based, ~500 chars max)
 * 5. Generate embedding for each chunk via AiClient.createEmbedding
 * 6. Store chunks with embeddings
 * 7. Set status to "ready" on success
 * 8. On error: preserve the last good chunks and set status to "failed"
 * 9. Record audit log entry
 */

import type { KnowledgeRepository } from '../repositories/knowledge-repository.js';
import type { AiClient } from '../interfaces/ai-client.js';
import type { AuditLogRepository } from '../repositories/audit-log-repository.js';
import type { AiSettingsRepository } from '../repositories/ai-settings-repository.js';
import type { CreateChunkInput } from '../types/index.js';
import { DEFAULT_EMBEDDING_MODEL } from '../types/ai-models.js';
import { splitIntoChunks } from '../utils/chunking.js';

/**
 * Interface for fetching file content from a URL.
 * Injected to keep the service portable (no direct HTTP dependency).
 */
export interface FileContentFetcher {
  /**
   * Fetch the text content of a file at the given URL.
   * Implementations should handle PDF, TXT, MD, CSV, and DOCX extraction.
   * Returns the extracted plain text.
   */
  fetchTextContent(url: string, fileName: string, fileKey?: string | null): Promise<string>;
}

export type KnowledgeIngestionOutcome = 'processed' | 'superseded';

export class KnowledgeIngestionService {
  constructor(
    private knowledgeRepo: KnowledgeRepository,
    private aiClient: AiClient,
    private auditLog: AuditLogRepository,
    private fileFetcher?: FileContentFetcher,
    private aiSettingsRepo?: AiSettingsRepository,
  ) {}

  /**
   * Process a knowledge document: chunk, embed, and store.
   *
   * @param documentId - The ID of the document to process
   * @param expectedRevision - Immutable content revision from the queue job.
   *   Stale jobs exit without overwriting chunks/status for a newer edit.
   */
  async processDocument(
    documentId: string,
    expectedRevision?: string,
  ): Promise<KnowledgeIngestionOutcome> {
    // 1. Load the document
    const document = await this.knowledgeRepo.getDocument(documentId);
    if (!document) {
      throw new Error(`Document not found: ${documentId}`);
    }
    if (expectedRevision && document.contentRevision !== expectedRevision) {
      return 'superseded';
    }
    // Jobs created before migration 016 have no revision in their payload.
    // Snapshot the row's current revision so they still cannot overwrite an
    // edit that lands while embedding is in progress.
    const contentRevision = expectedRevision ?? document.contentRevision ?? undefined;
    let contentReady = false;
    let fileExtractionWarning: string | null = null;

    try {
      // 2. Set status to "processing"
      if (contentRevision) {
        const markedProcessing = await this.knowledgeRepo.updateDocumentForRevision(
          documentId,
          contentRevision,
          { status: 'processing' },
        );
        if (!markedProcessing) return 'superseded';
      } else {
        await this.knowledgeRepo.updateDocument(documentId, { status: 'processing' });
      }

      // 3. Gather text content: body + file content
      let fullText = document.body ?? '';

      if (document.fileUrl && document.fileName && this.fileFetcher) {
        try {
          const fileContent = await this.fileFetcher.fetchTextContent(
            document.fileUrl,
            document.fileName,
            document.fileKey,
          );
          if (fileContent.trim()) {
            // Append file content after body, separated by double newline
            fullText = fullText.trim()
              ? `${fullText.trim()}\n\n${fileContent.trim()}`
              : fileContent.trim();
          }
        } catch (fileErr) {
          // If file extraction fails, proceed with body text only.
          // If there's no body text either, re-throw to mark as failed.
          if (!fullText.trim()) {
            throw new Error(
              `File extraction failed and no body text available: ${fileErr instanceof Error ? fileErr.message : 'Unknown error'}`,
            );
          }
          // Otherwise continue with body text, but keep the degradation in the
          // durable success audit instead of silently discarding it.
          fileExtractionWarning = fileErr instanceof Error
            ? fileErr.message
            : 'Unknown file extraction error';
        }
      }

      // 4. Split into chunks
      const textChunks = splitIntoChunks(fullText);

      if (textChunks.length === 0) {
        throw new Error('Document body produced no chunks after splitting');
      }

      // 4a. Resolve the org's embedding model (fall back to the package default
      //     if no settings row exists or the repo is not wired in tests).
      const orgSettings = this.aiSettingsRepo
        ? await this.aiSettingsRepo.findByOrg(document.organizationId)
        : null;
      const embeddingModel = orgSettings?.embeddingModel ?? DEFAULT_EMBEDDING_MODEL;

      // 5. Generate embeddings for each chunk
      const chunkInputs: CreateChunkInput[] = [];
      for (const chunkText of textChunks) {
        const embedding = await this.aiClient.createEmbedding({
          model: embeddingModel,
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

      // 6. Atomically replace existing chunks with the freshly embedded version.
      if (contentRevision) {
        const replaced = await this.knowledgeRepo.replaceChunksForRevision(
          documentId,
          document.organizationId,
          contentRevision,
          chunkInputs,
        );
        if (!replaced) return 'superseded';
      } else {
        await this.knowledgeRepo.replaceChunksByDocument(
          documentId,
          document.organizationId,
          chunkInputs,
        );
      }

      // 7. Set status to "ready". Also clear any stale `error_message`
      //    from a previous failed run — otherwise the row keeps the old
      //    error even after a successful reprocess, and the UI renders
      //    a red "Failed" badge on a doc that's actually ready.
      if (contentRevision) {
        const markedReady = await this.knowledgeRepo.updateDocumentForRevision(
          documentId,
          contentRevision,
          { status: 'ready', errorMessage: null },
        );
        if (!markedReady) return 'superseded';
      } else {
        await this.knowledgeRepo.updateDocument(documentId, {
          status: 'ready',
          errorMessage: null,
        });
      }
      contentReady = true;

      // 9. Record audit log entry for success
      await this.auditLog.create({
        organizationId: document.organizationId,
        actorType: 'system',
        action: 'knowledge_document_processed',
        resourceType: 'knowledge_document',
        resourceId: documentId,
        metadata: {
          chunkCount: chunkInputs.length,
          status: 'ready',
          ...(fileExtractionWarning ? { fileExtractionWarning } : {}),
        },
      });
      return 'processed';
    } catch (err) {
      // The content and ready state are already durable. Keep an audit outage
      // retryable at the job layer without falsely marking a healthy document
      // as failed or discarding its last-good chunks.
      if (contentReady) throw err;

      // 8. On error: set status to "failed". Chunk replacement is atomic, so
      // old chunks remain intact if re-indexing fails before or during replace.
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';

      let markedFailed = true;
      const finalizationErrors: string[] = [];
      try {
        if (contentRevision) {
          markedFailed = await this.knowledgeRepo.updateDocumentForRevision(
            documentId,
            contentRevision,
            { status: 'failed', errorMessage },
          );
        } else {
          await this.knowledgeRepo.updateDocument(documentId, {
            status: 'failed',
            errorMessage,
          });
        }
      } catch (statusError) {
        finalizationErrors.push(
          `failed to persist document failure status: ${statusError instanceof Error ? statusError.message : String(statusError)}`,
        );
      }

      // A newer edit superseded this job while it was processing. Its status
      // and audit trail belong to the newer revision, so finish this stale job
      // without retrying or recording a false failure.
      if (contentRevision && !markedFailed) {
        return 'superseded';
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
      } catch (auditError) {
        finalizationErrors.push(
          `failed to persist failure audit: ${auditError instanceof Error ? auditError.message : String(auditError)}`,
        );
      }

      if (finalizationErrors.length > 0) {
        throw new Error(
          `${errorMessage}; ${finalizationErrors.join('; ')}`,
          { cause: err },
        );
      }
      throw err;
    }
  }
}
