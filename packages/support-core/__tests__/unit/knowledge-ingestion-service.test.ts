import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KnowledgeIngestionService } from '../../src/services/knowledge-ingestion-service.js';
import type { KnowledgeRepository } from '../../src/repositories/knowledge-repository.js';
import type { AuditLogRepository } from '../../src/repositories/audit-log-repository.js';
import type { AiClient } from '../../src/interfaces/ai-client.js';
import type { KnowledgeDocument, AuditLog } from '../../src/types/index.js';

/**
 * Unit tests for KnowledgeIngestionService.
 *
 * Tests status transitions (pending → processing → ready/failed)
 * and chunk cleanup on failure.
 */

// ─── Fixtures ─────────────────────────────────────────────────────

const ORG_ID = 'org-001';
const DOC_ID = 'doc-001';

const SAMPLE_DOCUMENT: KnowledgeDocument = {
  id: DOC_ID,
  organizationId: ORG_ID,
  title: 'Return Policy',
  sourceType: 'faq',
  body: 'Items can be returned within 30 days of purchase. Refunds are processed within 5 business days.',
  status: 'pending',
  errorMessage: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const SAMPLE_AUDIT_LOG: AuditLog = {
  id: 'audit-001',
  organizationId: ORG_ID,
  actorId: null,
  actorType: 'system',
  action: 'knowledge_document_processed',
  resourceType: 'knowledge_document',
  resourceId: DOC_ID,
  metadata: {},
  createdAt: new Date(),
};

// ─── Mock Factories ───────────────────────────────────────────────

function createMockKnowledgeRepo(): KnowledgeRepository {
  return {
    getDocument: vi.fn().mockResolvedValue(SAMPLE_DOCUMENT),
    updateDocument: vi.fn().mockResolvedValue(SAMPLE_DOCUMENT),
    insertChunks: vi.fn().mockResolvedValue([]),
    deleteChunksByDocument: vi.fn().mockResolvedValue(undefined),
    createDocument: vi.fn(),
    deleteDocumentWithChunks: vi.fn(),
    matchChunks: vi.fn(),
  } as unknown as KnowledgeRepository;
}

function createMockAiClient(): AiClient {
  return {
    chatCompletion: vi.fn(),
    createEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0)),
  };
}

function createMockAuditLog(): AuditLogRepository {
  return {
    create: vi.fn().mockResolvedValue(SAMPLE_AUDIT_LOG),
  } as unknown as AuditLogRepository;
}

// ─── Tests ────────────────────────────────────────────────────────

describe('KnowledgeIngestionService', () => {
  let knowledgeRepo: ReturnType<typeof createMockKnowledgeRepo>;
  let aiClient: ReturnType<typeof createMockAiClient>;
  let auditLog: ReturnType<typeof createMockAuditLog>;
  let service: KnowledgeIngestionService;

  beforeEach(() => {
    knowledgeRepo = createMockKnowledgeRepo();
    aiClient = createMockAiClient();
    auditLog = createMockAuditLog();
    service = new KnowledgeIngestionService(knowledgeRepo, aiClient, auditLog);
  });

  describe('successful processing', () => {
    it('transitions document from pending → processing → ready', async () => {
      await service.processDocument(DOC_ID);

      // Should set status to "processing" first
      expect(knowledgeRepo.updateDocument).toHaveBeenCalledWith(DOC_ID, {
        status: 'processing',
      });

      // Should set status to "ready" on success
      expect(knowledgeRepo.updateDocument).toHaveBeenCalledWith(DOC_ID, {
        status: 'ready',
      });

      // Verify order: processing before ready
      const calls = vi.mocked(knowledgeRepo.updateDocument).mock.calls;
      const processingIdx = calls.findIndex(
        (c) => (c[1] as Record<string, unknown>).status === 'processing',
      );
      const readyIdx = calls.findIndex(
        (c) => (c[1] as Record<string, unknown>).status === 'ready',
      );
      expect(processingIdx).toBeLessThan(readyIdx);
    });

    it('generates embeddings for each chunk', async () => {
      await service.processDocument(DOC_ID);

      // Should call createEmbedding at least once (for each chunk)
      expect(aiClient.createEmbedding).toHaveBeenCalled();
    });

    it('stores chunks with embeddings', async () => {
      await service.processDocument(DOC_ID);

      expect(knowledgeRepo.insertChunks).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            documentId: DOC_ID,
            organizationId: ORG_ID,
            content: expect.any(String),
            embedding: expect.any(Array),
          }),
        ]),
      );
    });

    it('records audit log on success', async () => {
      await service.processDocument(DOC_ID);

      expect(auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: ORG_ID,
          action: 'knowledge_document_processed',
          resourceType: 'knowledge_document',
          resourceId: DOC_ID,
        }),
      );
    });
  });

  describe('failure handling', () => {
    it('sets status to "failed" when embedding fails', async () => {
      aiClient.createEmbedding = vi.fn().mockRejectedValue(new Error('Embedding API error'));

      await expect(service.processDocument(DOC_ID)).rejects.toThrow('Embedding API error');

      // Should set status to "failed"
      expect(knowledgeRepo.updateDocument).toHaveBeenCalledWith(DOC_ID, {
        status: 'failed',
        errorMessage: 'Embedding API error',
      });
    });

    it('cleans up partial chunks on failure', async () => {
      aiClient.createEmbedding = vi.fn().mockRejectedValue(new Error('API error'));

      await expect(service.processDocument(DOC_ID)).rejects.toThrow();

      // Should clean up chunks
      expect(knowledgeRepo.deleteChunksByDocument).toHaveBeenCalledWith(DOC_ID);
    });

    it('records audit log on failure', async () => {
      aiClient.createEmbedding = vi.fn().mockRejectedValue(new Error('API error'));

      await expect(service.processDocument(DOC_ID)).rejects.toThrow();

      expect(auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'knowledge_document_failed',
          metadata: expect.objectContaining({ status: 'failed' }),
        }),
      );
    });

    it('throws when document is not found', async () => {
      vi.mocked(knowledgeRepo.getDocument).mockResolvedValue(null);

      await expect(service.processDocument('nonexistent')).rejects.toThrow(
        'Document not found: nonexistent',
      );
    });
  });

  // ─── HIGH-3 cost-amplification guards ──────────────────────────────

  describe('HIGH-3 cost-amplification guards', () => {
    function oversizedDocument(byteLength: number): KnowledgeDocument {
      return {
        ...SAMPLE_DOCUMENT,
        // ASCII so length-in-chars === byte-length.
        body: 'a'.repeat(byteLength),
      };
    }

    it('rejects documents over MAX_BODY_BYTES without doing embedding work', async () => {
      const huge = oversizedDocument(1_000_001);
      vi.mocked(knowledgeRepo.getDocument).mockResolvedValue(huge);

      await expect(service.processDocument(DOC_ID)).rejects.toThrow(/exceeds 1000000 bytes/);

      // Should NOT have called the embedding API at all — fail fast.
      expect(aiClient.createEmbedding).not.toHaveBeenCalled();
      // Should mark the document as failed.
      expect(knowledgeRepo.updateDocument).toHaveBeenCalledWith(
        DOC_ID,
        expect.objectContaining({ status: 'failed' }),
      );
      // Should record a failure audit log.
      expect(auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'knowledge_document_failed' }),
      );
    });

    it('rejects documents whose chunks exceed the chunk-count cap', async () => {
      // Build a body that produces > MAX_CHUNKS chunks. Each chunk is
      // ~500 chars max; we need > 500 chunks → body of ~250 KB split on
      // paragraph boundaries. With maxChunkSize 500 the chunking util
      // produces one chunk per ~500-char paragraph, so 600 paragraphs of
      // 500 chars each gives us 600 chunks.
      const longParagraph = 'word '.repeat(99).trim(); // 495 chars
      const body = Array.from({ length: 600 }, () => longParagraph).join('\n\n');
      const doc: KnowledgeDocument = { ...SAMPLE_DOCUMENT, body };
      vi.mocked(knowledgeRepo.getDocument).mockResolvedValue(doc);

      await expect(service.processDocument(DOC_ID)).rejects.toThrow(/exceeding the 500-chunk cap/);

      // Cap fires after we set status to "processing" but before we burn
      // through the whole document. The point of the cap is to bound the
      // *future* spend, not to refund what we'd already done; we accept
      // that we may have made up to MAX_CONCURRENCY * BATCH_SIZE
      // (256) embedding calls in the worst case before the worker
      // notices. The doc fails cleanly either way.
      expect(knowledgeRepo.updateDocument).toHaveBeenCalledWith(
        DOC_ID,
        expect.objectContaining({ status: 'failed' }),
      );
    });

    it('inserts chunks incrementally per batch rather than all at once', async () => {
      // Body long enough to produce multiple batches (BATCH_SIZE = 32,
      // each paragraph = 1 chunk).
      const longParagraph = 'word '.repeat(99).trim(); // ~495 chars
      const body = Array.from({ length: 80 }, () => longParagraph).join('\n\n');
      vi.mocked(knowledgeRepo.getDocument).mockResolvedValue({
        ...SAMPLE_DOCUMENT,
        body,
      });

      // Spy on the order of insertChunks vs createEmbedding calls.
      const insertOrder: number[] = [];
      vi.mocked(knowledgeRepo.insertChunks).mockImplementation(async (chunks) => {
        insertOrder.push(chunks.length);
        return [];
      });

      await service.processDocument(DOC_ID);

      // 80 chunks / BATCH_SIZE 32 = 3 batches (32, 32, 16). Each
      // insertChunks call gets a single batch's chunks, and is called
      // at least 3 times (it could be more if MAX_CONCURRENCY splits
      // batches across workers, but each call still receives ≤ BATCH_SIZE
      // chunks).
      expect(insertOrder.length).toBeGreaterThanOrEqual(3);
      for (const size of insertOrder) {
        expect(size).toBeLessThanOrEqual(32);
        expect(size).toBeGreaterThan(0);
      }
    });

    it('retries transient embedding failures up to MAX_RETRIES_PER_BATCH times', async () => {
      // Two transient failures, then success.
      const embeddingMock = vi
        .fn()
        .mockRejectedValueOnce(new Error('502 Bad Gateway'))
        .mockRejectedValueOnce(new Error('503 Service Unavailable'))
        .mockResolvedValueOnce(new Array(1536).fill(0));
      aiClient.createEmbedding = embeddingMock;

      await service.processDocument(DOC_ID);

      // 1 chunk → 3 calls total (2 retries + 1 success).
      expect(embeddingMock).toHaveBeenCalledTimes(3);
    });

    it('fails the document after exhausting embedding retries', async () => {
      aiClient.createEmbedding = vi
        .fn()
        .mockRejectedValue(new Error('Persistent 500'));

      await expect(service.processDocument(DOC_ID)).rejects.toThrow('Persistent 500');

      // 1 chunk × MAX_RETRIES_PER_BATCH (3) = 3 calls.
      expect(aiClient.createEmbedding).toHaveBeenCalledTimes(3);
      expect(knowledgeRepo.updateDocument).toHaveBeenCalledWith(
        DOC_ID,
        expect.objectContaining({ status: 'failed', errorMessage: 'Persistent 500' }),
      );
    });
  });
});
