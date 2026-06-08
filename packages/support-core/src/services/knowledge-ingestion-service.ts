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
 * 8. On error: clean up partial chunks, set status to "failed" with error message
 * 9. Record audit log entry
 */

import type { KnowledgeRepository } from '../repositories/knowledge-repository.js';
import type { AiClient } from '../interfaces/ai-client.js';
import type { AuditLogRepository } from '../repositories/audit-log-repository.js';
import type { CreateChunkInput } from '../types/index.js';
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
  fetchTextContent(url: string, fileName: string): Promise<string>;
}

export class KnowledgeIngestionService {
  constructor(
    private knowledgeRepo: KnowledgeRepository,
    private aiClient: AiClient,
    private auditLog: AuditLogRepository,
    private fileFetcher?: FileContentFetcher,
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

      // 3. Gather text content: body + file content
      let fullText = document.body ?? '';

      if (document.fileUrl && document.fileName && this.fileFetcher) {
        try {
          const fileContent = await this.fileFetcher.fetchTextContent(
            document.fileUrl,
            document.fileName,
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
          // Otherwise continue with body text only — partial processing is better than none
        }
      }

      // 4. Split into chunks
      const textChunks = splitIntoChunks(fullText);

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
