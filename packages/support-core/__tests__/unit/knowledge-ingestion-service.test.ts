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
    replaceChunksByDocument: vi.fn().mockResolvedValue([]),
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

    it('throws when document is not found', async () => {
      vi.mocked(knowledgeRepo.getDocument).mockResolvedValue(null);

      await expect(service.processDocument('nonexistent')).rejects.toThrow(
        'Document not found: nonexistent',
      );
    });
  });
});
