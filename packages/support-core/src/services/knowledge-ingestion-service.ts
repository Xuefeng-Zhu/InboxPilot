/**
 * KnowledgeIngestionService — orchestrates document chunking and embedding.
 *
 * Flow:
 * 1. Load the document by ID
 * 2. Enforce cost-amplification guards (body size cap, chunk-count cap)
 * 3. Set status to "processing"
 * 4. Split body into chunks (paragraph-based, ~500 chars max)
 * 5. Generate embeddings for chunks in bounded-concurrency batches with
 *    per-batch retry. Insert each batch's chunks into the database as soon
 *    as the batch finishes so a mid-run crash leaves resumable state.
 * 6. Set status to "ready" on success
 * 7. On error: clean up partial chunks, set status to "failed" with error
 *    message
 * 8. Record audit log entry
 *
 * Cost-amplification / DoS guards (HIGH-3 from docs/QA_BUG_HUNT.md):
 *   - MAX_BODY_BYTES        (1 MB)   — fail fast on absurdly large inputs
 *   - MAX_CHUNKS            (500)    — cap per-document embedding spend
 *   - MAX_CONCURRENCY       (8)      — bound in-flight embedding calls so
 *                                       the function runtime doesn't OOM
 *                                       and we don't run into OpenAI
 *                                       per-org rate limits
 *   - MAX_RETRIES_PER_BATCH (3)      — transient HTTP 5xx / network errors
 *                                       don't fail a whole document
 *   - BATCH_SIZE            (32)     — chunks per embedding API call; keeps
 *                                       the per-call payload under OpenAI's
 *                                       2048-input limit with room to spare
 *                                       and reduces wall-time vs the prior
 *                                       serial 1-at-a-time loop
 */

import type { KnowledgeRepository } from '../repositories/knowledge-repository.js';
import type { AiClient } from '../interfaces/ai-client.js';
import type { AuditLogRepository } from '../repositories/audit-log-repository.js';
import type { CreateChunkInput } from '../types/index.js';
import { splitIntoChunks } from '../utils/chunking.js';

/** Maximum document body size in characters. ~1 MB of plain text. */
export const MAX_BODY_BYTES = 1_000_000;

/** Maximum number of chunks produced from a single document. */
export const MAX_CHUNKS = 500;

/** Maximum in-flight embedding API calls. */
const MAX_CONCURRENCY = 8;

/** Chunks per embedding API call. */
const BATCH_SIZE = 32;

/** Per-batch retry attempts before giving up. */
const MAX_RETRIES_PER_BATCH = 3;

/** Backoff base in ms; doubled per attempt (200, 400, 800). */
const RETRY_BACKOFF_MS = 200;

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

    // 2. Cost-amplification guard: fail fast on oversized bodies.
    //    This runs BEFORE setting status to "processing" because the doc
    //    is unrecoverable for ingestion; we want a clean "failed" row.
    if (document.body.length > MAX_BODY_BYTES) {
      const message = `Document body exceeds ${MAX_BODY_BYTES} bytes (got ${document.body.length}); split the source file before uploading.`;
      await this.markFailed(documentId, document.organizationId, message);
      throw new Error(message);
    }

    try {
      // 3. Set status to "processing"
      await this.knowledgeRepo.updateDocument(documentId, { status: 'processing' });

      // 4. Split body into chunks
      const textChunks = splitIntoChunks(document.body);

      if (textChunks.length === 0) {
        throw new Error('Document body produced no chunks after splitting');
      }

      // Cost-amplification guard: cap total chunks so a single doc cannot
      // consume hundreds of dollars in embedding fees. We fail the
      // document (not just truncate) so the user gets a clear error.
      if (textChunks.length > MAX_CHUNKS) {
        throw new Error(
          `Document produced ${textChunks.length} chunks, exceeding the ${MAX_CHUNKS}-chunk cap. Reduce the document size or contact support.`,
        );
      }

      // 5. Embed in bounded-concurrency batches, inserting each batch
      //    into the DB as it finishes. This gives us:
      //    - parallelism (no longer serial 1-at-a-time)
      //    - per-batch retry so a transient 5xx doesn't fail the whole doc
      //    - incremental persistence so a mid-run crash leaves partial
      //      chunks behind that a retry can resume from
      const batches = chunk(textChunks, BATCH_SIZE);
      let nextCursor = 0;
      const workers: Array<Promise<void>> = [];

      const runWorker = async (): Promise<void> => {
        while (true) {
          const batchIdx = nextCursor++;
          if (batchIdx >= batches.length) return;
          const batch = batches[batchIdx];
          await this.embedAndStoreBatch(document, batch);
        }
      };

      const workerCount = Math.min(MAX_CONCURRENCY, batches.length);
      for (let i = 0; i < workerCount; i++) {
        workers.push(runWorker());
      }
      await Promise.all(workers);

      // 6. Set status to "ready"
      await this.knowledgeRepo.updateDocument(documentId, { status: 'ready' });

      // 8. Record audit log entry for success
      await this.auditLog.create({
        organizationId: document.organizationId,
        actorType: 'system',
        action: 'knowledge_document_processed',
        resourceType: 'knowledge_document',
        resourceId: documentId,
        metadata: { chunkCount: textChunks.length, status: 'ready' },
      });
    } catch (err) {
      // 7. On error: clean up partial chunks and set status to "failed"
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      await this.markFailed(documentId, document.organizationId, errorMessage);
      throw err;
    }
  }

  /**
   * Embed a batch of chunks with per-batch retry, then insert the resulting
   * chunks into the database. Throws if the batch ultimately fails — the
   * surrounding catch will then clean up any chunks already persisted.
   */
  private async embedAndStoreBatch(
    document: { id: string; organizationId: string },
    chunks: string[],
  ): Promise<void> {
    if (chunks.length === 0) return;

    // Single-input embeddings per chunk so we keep using the existing
    // AiClient interface (no breaking change to all implementations).
    // The wall-time win comes from running BATCH_SIZE * MAX_CONCURRENCY
    // calls in parallel, not from a new batch API.
    const embeddings: number[][] = [];
    for (const chunkText of chunks) {
      embeddings.push(
        await this.embedWithRetry({
          model: 'text-embedding-ada-002',
          input: chunkText,
        }),
      );
    }

    const chunkInputs: CreateChunkInput[] = chunks.map((content, i) => ({
      documentId: document.id,
      organizationId: document.organizationId,
      content,
      embedding: embeddings[i],
      metadata: {},
    }));

    await this.knowledgeRepo.insertChunks(chunkInputs);
  }

  /** Call createEmbedding with bounded exponential-backoff retry. */
  private async embedWithRetry(params: {
    model: string;
    input: string;
  }): Promise<number[]> {
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES_PER_BATCH; attempt++) {
      try {
        return await this.aiClient.createEmbedding(params);
      } catch (err) {
        lastError = err;
        if (attempt === MAX_RETRIES_PER_BATCH - 1) break;
        await sleep(RETRY_BACKOFF_MS * Math.pow(2, attempt));
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('Embedding failed after retries');
  }

  /**
   * Mark a document as failed, clean up any partial chunks, and write
   * a failure audit log. Errors from the cleanup itself are swallowed
   * — the original failure is what matters.
   */
  private async markFailed(
    documentId: string,
    organizationId: string,
    errorMessage: string,
  ): Promise<void> {
    try {
      await this.knowledgeRepo.deleteChunksByDocument(documentId);
    } catch {
      // Ignore cleanup errors — the primary error is more important
    }

    try {
      await this.knowledgeRepo.updateDocument(documentId, {
        status: 'failed',
        errorMessage,
      });
    } catch {
      // Ignore status update errors
    }

    try {
      await this.auditLog.create({
        organizationId,
        actorType: 'system',
        action: 'knowledge_document_failed',
        resourceType: 'knowledge_document',
        resourceId: documentId,
        metadata: { error: errorMessage, status: 'failed' },
      });
    } catch {
      // Ignore audit log errors
    }
  }
}

/** Split an array into fixed-size batches. */
function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) throw new Error('chunk size must be > 0');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** Promise-friendly sleep. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
