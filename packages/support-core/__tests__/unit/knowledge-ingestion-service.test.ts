import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KnowledgeIngestionService } from '../../src/services/knowledge-ingestion-service.js';
import type { KnowledgeRepository } from '../../src/repositories/knowledge-repository.js';
import type { AuditLogRepository } from '../../src/repositories/audit-log-repository.js';
import type { AiSettingsRepository } from '../../src/repositories/ai-settings-repository.js';
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
const REVISION = '11111111-1111-4111-8111-111111111111';

const SAMPLE_DOCUMENT: KnowledgeDocument = {
  id: DOC_ID,
  organizationId: ORG_ID,
  title: 'Return Policy',
  sourceType: 'faq',
  body: 'Items can be returned within 30 days of purchase. Refunds are processed within 5 business days.',
  status: 'pending',
  errorMessage: null,
  fileUrl: null,
  fileName: null,
  fileKey: null,
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
    updateDocumentForRevision: vi.fn().mockResolvedValue(true),
    replaceChunksByDocument: vi.fn().mockResolvedValue([]),
    replaceChunksForRevision: vi.fn().mockResolvedValue(true),
    deleteChunksByDocument: vi.fn().mockResolvedValue(undefined),
    createDocument: vi.fn(),
    deleteDocumentWithChunks: vi.fn(),
    matchChunks: vi.fn(),
    searchChunksByText: vi.fn(),
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

function createMockAiSettingsRepo(): AiSettingsRepository {
  return {
    findByOrg: vi.fn().mockResolvedValue({
      embeddingModel: 'openai/text-embedding-3-small',
    }),
    create: vi.fn(),
    update: vi.fn(),
  } as unknown as AiSettingsRepository;
}

// ─── Tests ────────────────────────────────────────────────────────

describe('KnowledgeIngestionService', () => {
  let knowledgeRepo: ReturnType<typeof createMockKnowledgeRepo>;
  let aiClient: ReturnType<typeof createMockAiClient>;
  let auditLog: ReturnType<typeof createMockAuditLog>;
  let aiSettingsRepo: ReturnType<typeof createMockAiSettingsRepo>;
  let service: KnowledgeIngestionService;

  beforeEach(() => {
    knowledgeRepo = createMockKnowledgeRepo();
    aiClient = createMockAiClient();
    auditLog = createMockAuditLog();
    aiSettingsRepo = createMockAiSettingsRepo();
    service = new KnowledgeIngestionService(
      knowledgeRepo, aiClient, auditLog, undefined, aiSettingsRepo,
    );
  });

  describe('successful processing', () => {
    it('transitions document from pending → processing → ready', async () => {
      await service.processDocument(DOC_ID);

      // Should set status to "processing" first
      expect(knowledgeRepo.updateDocument).toHaveBeenCalledWith(DOC_ID, {
        status: 'processing',
      });

      // Should set status to "ready" on success (and clear any stale
      // error_message from a previous failed run — see the dedicated
      // "clears any previous errorMessage" test below).
      expect(knowledgeRepo.updateDocument).toHaveBeenCalledWith(DOC_ID, {
        status: 'ready',
        errorMessage: null,
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

      expect(knowledgeRepo.replaceChunksByDocument).toHaveBeenCalledWith(
        DOC_ID,
        ORG_ID,
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

    it('does not mark ready content failed when only success audit persistence fails', async () => {
      vi.mocked(auditLog.create).mockRejectedValueOnce(new Error('audit unavailable'));

      await expect(service.processDocument(DOC_ID)).rejects.toThrow('audit unavailable');

      expect(knowledgeRepo.updateDocument).toHaveBeenCalledWith(DOC_ID, {
        status: 'ready',
        errorMessage: null,
      });
      expect(knowledgeRepo.updateDocument).not.toHaveBeenCalledWith(
        DOC_ID,
        expect.objectContaining({ status: 'failed' }),
      );
    });

    it('uses revision-guarded writes for queued knowledge work', async () => {
      vi.mocked(knowledgeRepo.getDocument).mockResolvedValue({
        ...SAMPLE_DOCUMENT,
        contentRevision: REVISION,
      });

      await service.processDocument(DOC_ID, REVISION);

      expect(knowledgeRepo.updateDocument).not.toHaveBeenCalled();
      expect(knowledgeRepo.updateDocumentForRevision).toHaveBeenNthCalledWith(
        1,
        DOC_ID,
        REVISION,
        { status: 'processing' },
      );
      expect(knowledgeRepo.replaceChunksForRevision).toHaveBeenCalledWith(
        DOC_ID,
        ORG_ID,
        REVISION,
        expect.any(Array),
      );
      expect(knowledgeRepo.updateDocumentForRevision).toHaveBeenNthCalledWith(
        2,
        DOC_ID,
        REVISION,
        { status: 'ready', errorMessage: null },
      );
    });

    it('does no work when a queued revision is already stale', async () => {
      vi.mocked(knowledgeRepo.getDocument).mockResolvedValue({
        ...SAMPLE_DOCUMENT,
        contentRevision: '22222222-2222-4222-8222-222222222222',
      });

      await service.processDocument(DOC_ID, REVISION);

      expect(knowledgeRepo.updateDocumentForRevision).not.toHaveBeenCalled();
      expect(aiClient.createEmbedding).not.toHaveBeenCalled();
      expect(knowledgeRepo.replaceChunksForRevision).not.toHaveBeenCalled();
      expect(auditLog.create).not.toHaveBeenCalled();
    });

    it('does not publish stale chunks when a newer edit arrives during embedding', async () => {
      vi.mocked(knowledgeRepo.getDocument).mockResolvedValue({
        ...SAMPLE_DOCUMENT,
        contentRevision: REVISION,
      });
      vi.mocked(knowledgeRepo.replaceChunksForRevision).mockResolvedValue(false);

      await expect(service.processDocument(DOC_ID, REVISION)).resolves.toBe('superseded');

      expect(knowledgeRepo.replaceChunksForRevision).toHaveBeenCalled();
      expect(knowledgeRepo.updateDocumentForRevision).toHaveBeenCalledTimes(1);
      expect(auditLog.create).not.toHaveBeenCalled();
    });

    it('snapshots the current revision for legacy jobs without one in their payload', async () => {
      vi.mocked(knowledgeRepo.getDocument).mockResolvedValue({
        ...SAMPLE_DOCUMENT,
        contentRevision: REVISION,
      });

      await expect(service.processDocument(DOC_ID)).resolves.toBe('processed');

      expect(knowledgeRepo.updateDocument).not.toHaveBeenCalled();
      expect(knowledgeRepo.replaceChunksForRevision).toHaveBeenCalledWith(
        DOC_ID,
        ORG_ID,
        REVISION,
        expect.any(Array),
      );
    });

    it('passes the storage key to the injected file fetcher', async () => {
      const fileFetcher = {
        fetchTextContent: vi.fn().mockResolvedValue('File-backed knowledge content.'),
      };
      vi.mocked(knowledgeRepo.getDocument).mockResolvedValue({
        ...SAMPLE_DOCUMENT,
        body: '',
        fileUrl: 'https://storage.example.invalid/object',
        fileName: 'policy.txt',
        fileKey: `${ORG_ID}/documents/policy.txt`,
      });
      service = new KnowledgeIngestionService(
        knowledgeRepo,
        aiClient,
        auditLog,
        fileFetcher,
        aiSettingsRepo,
      );

      await service.processDocument(DOC_ID);

      expect(fileFetcher.fetchTextContent).toHaveBeenCalledWith(
        'https://storage.example.invalid/object',
        'policy.txt',
        `${ORG_ID}/documents/policy.txt`,
      );
    });

    it('records degraded file extraction when body fallback succeeds', async () => {
      const fileFetcher = {
        fetchTextContent: vi.fn().mockRejectedValue(new Error('PDF parser unavailable')),
      };
      vi.mocked(knowledgeRepo.getDocument).mockResolvedValue({
        ...SAMPLE_DOCUMENT,
        fileUrl: 'https://storage.example.invalid/object',
        fileName: 'policy.pdf',
      });
      service = new KnowledgeIngestionService(
        knowledgeRepo,
        aiClient,
        auditLog,
        fileFetcher,
        aiSettingsRepo,
      );

      await expect(service.processDocument(DOC_ID)).resolves.toBe('processed');

      expect(auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        metadata: expect.objectContaining({
          fileExtractionWarning: 'PDF parser unavailable',
        }),
      }));
    });

    it('clears any previous errorMessage when reprocessing succeeds', async () => {
      // Simulate a doc that was previously failed (still has a stale
      // error_message from the prior attempt). Reprocessing should not
      // leave the stale error in the row — otherwise the UI will show a
      // red "Failed" badge on a doc that actually succeeded.
      const previouslyFailedDoc: KnowledgeDocument = {
        ...SAMPLE_DOCUMENT,
        status: 'pending',
        errorMessage: 'KnowledgeRepository.deleteChunksByDocument failed: ...',
      };
      vi.mocked(knowledgeRepo.getDocument).mockResolvedValue(previouslyFailedDoc);

      await service.processDocument(DOC_ID);

      // The status='ready' call must also clear the stale error.
      const calls = vi.mocked(knowledgeRepo.updateDocument).mock.calls;
      const readyCall = calls.find(
        (c) => (c[1] as Record<string, unknown>).status === 'ready',
      );
      expect(readyCall).toBeDefined();
      expect((readyCall![1] as Record<string, unknown>).errorMessage).toBeNull();
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

    it('preserves existing chunks when embedding fails before replacement', async () => {
      aiClient.createEmbedding = vi.fn().mockRejectedValue(new Error('API error'));

      await expect(service.processDocument(DOC_ID)).rejects.toThrow();

      expect(knowledgeRepo.replaceChunksByDocument).not.toHaveBeenCalled();
      expect(knowledgeRepo.deleteChunksByDocument).not.toHaveBeenCalled();
    });

    it('sets status to "failed" when replaceChunksByDocument throws', async () => {
      // Embedding succeeds, but the atomic replace RPC fails (e.g.,
      // PostgREST 502 or a missing doc FK). The doc should land in
      // 'failed' state and the error should be recorded — old chunks
      // remain intact because the RPC is atomic and rolls back on error.
      vi.mocked(knowledgeRepo.replaceChunksByDocument).mockRejectedValueOnce(
        new Error('PostgREST 502: bad gateway'),
      );

      await expect(service.processDocument(DOC_ID)).rejects.toThrow('PostgREST 502');

      expect(knowledgeRepo.updateDocument).toHaveBeenCalledWith(DOC_ID, {
        status: 'failed',
        errorMessage: 'PostgREST 502: bad gateway',
      });

      // No chunks were inserted (the RPC rolled back), so old chunks
      // are preserved — verified by the not-called assertion.
      expect(knowledgeRepo.deleteChunksByDocument).not.toHaveBeenCalled();
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

    it('surfaces status and audit persistence failures alongside the processing error', async () => {
      aiClient.createEmbedding = vi.fn().mockRejectedValue(new Error('Embedding API error'));
      vi.mocked(knowledgeRepo.updateDocument).mockImplementation(
        async (_id, updates) => {
          if (updates.status === 'failed') throw new Error('status database unavailable');
          return SAMPLE_DOCUMENT;
        },
      );
      vi.mocked(auditLog.create).mockRejectedValue(new Error('audit database unavailable'));

      await expect(service.processDocument(DOC_ID)).rejects.toThrow(
        'Embedding API error; failed to persist document failure status: status database unavailable; failed to persist failure audit: audit database unavailable',
      );
    });

    it('does not retry or audit a failure after the queued revision becomes stale', async () => {
      vi.mocked(knowledgeRepo.getDocument).mockResolvedValue({
        ...SAMPLE_DOCUMENT,
        contentRevision: REVISION,
      });
      vi.mocked(knowledgeRepo.updateDocumentForRevision)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      aiClient.createEmbedding = vi.fn().mockRejectedValue(new Error('Embedding API error'));

      await expect(service.processDocument(DOC_ID, REVISION)).resolves.toBe('superseded');

      expect(knowledgeRepo.updateDocumentForRevision).toHaveBeenNthCalledWith(
        2,
        DOC_ID,
        REVISION,
        { status: 'failed', errorMessage: 'Embedding API error' },
      );
      expect(auditLog.create).not.toHaveBeenCalled();
    });

    it('throws when document is not found', async () => {
      vi.mocked(knowledgeRepo.getDocument).mockResolvedValue(null);

      await expect(service.processDocument('nonexistent')).rejects.toThrow(
        'Document not found: nonexistent',
      );
    });
  });
});
