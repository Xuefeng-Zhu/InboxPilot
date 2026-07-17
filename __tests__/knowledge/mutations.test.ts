/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeDocument } from '../../components/knowledge/types';
import {
  createKnowledgeDocument,
  deleteKnowledgeDocument,
  reprocessKnowledgeDocument,
  updateKnowledgeDocument,
} from '../../app/knowledge/mutations';

const mocks = vi.hoisted(() => ({
  auditError: null as { message: string } | null,
  jobError: null as { message: string; code?: string } | null,
  documentInsertError: null as { message: string } | null,
  documentInsertData: [{ id: 'doc-1' }] as unknown,
  documentUpdateError: null as { message: string } | null,
  documentDeleteError: null as { message: string } | null,
  inserted: [] as Array<{ table: string; rows: unknown[] }>,
  updated: [] as Array<{ table: string; values: Record<string, unknown>; id: string }>,
  deleted: [] as Array<{ table: string; id: string }>,
  uploads: [] as Array<{ organizationId: string; fileName: string }>,
  removedFileKeys: [] as string[],
  rollbackCalls: [] as Array<{ fileKey: string; primaryError: string }>,
  removeError: null as Error | null,
}));

vi.mock('@/lib/insforge', () => ({
  insforge: {
    database: {
      from: vi.fn((table: string) => ({
        insert: vi.fn((rows: unknown[]) => {
          mocks.inserted.push({ table, rows });
          if (table === 'knowledge_documents') {
            return {
              select: vi.fn().mockResolvedValue({
                data: mocks.documentInsertData,
                error: mocks.documentInsertError,
              }),
            };
          }
          return Promise.resolve({
            data: null,
            error: table === 'audit_logs' ? mocks.auditError : mocks.jobError,
          });
        }),
        update: vi.fn((values: Record<string, unknown>) => ({
          eq: vi.fn(async (_column: string, id: string) => {
            mocks.updated.push({ table, values, id });
            return { data: null, error: mocks.documentUpdateError };
          }),
        })),
        delete: vi.fn(() => ({
          eq: vi.fn(async (_column: string, id: string) => {
            mocks.deleted.push({ table, id });
            return { data: null, error: mocks.documentDeleteError };
          }),
        })),
      })),
    },
  },
}));

vi.mock('../../app/knowledge/storage', () => ({
  uploadKnowledgeFile: vi.fn(async (organizationId: string, file: File) => {
    mocks.uploads.push({ organizationId, fileName: file.name });
    return { url: 'https://files.test/guide.pdf', key: 'org-1/documents/guide.pdf' };
  }),
  removeKnowledgeFile: vi.fn(async (fileKey: string) => {
    mocks.removedFileKeys.push(fileKey);
    if (mocks.removeError) throw mocks.removeError;
  }),
  rollbackKnowledgeUpload: vi.fn(async (fileKey: string, primaryError: string) => {
    mocks.rollbackCalls.push({ fileKey, primaryError });
    return `${primaryError} (upload rolled back)`;
  }),
}));

const document: KnowledgeDocument = {
  id: 'doc-1',
  organization_id: 'org-1',
  title: 'Guide',
  source_type: 'manual',
  body: 'Body',
  status: 'ready',
  error_message: null,
  file_url: 'https://files.test/guide.pdf',
  file_name: 'guide.pdf',
  file_key: 'org-1/documents/guide.pdf',
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
};

describe('knowledge mutation workflows', () => {
  afterEach(() => {
    mocks.auditError = null;
    mocks.jobError = null;
    mocks.documentInsertError = null;
    mocks.documentInsertData = [{ id: 'doc-1' }];
    mocks.documentUpdateError = null;
    mocks.documentDeleteError = null;
    mocks.inserted.length = 0;
    mocks.updated.length = 0;
    mocks.deleted.length = 0;
    mocks.uploads.length = 0;
    mocks.removedFileKeys.length = 0;
    mocks.rollbackCalls.length = 0;
    mocks.removeError = null;
    vi.clearAllMocks();
  });

  it('persists a new document and runs audit and processing follow-up tasks', async () => {
    const file = new File(['guide'], 'guide.pdf', { type: 'application/pdf' });

    const result = await createKnowledgeDocument({
      organizationId: 'org-1',
      actorId: 'user-1',
      document: {
        title: 'Guide',
        sourceType: 'manual',
        body: '',
        file,
      },
    });

    expect(result).toEqual({ documentId: 'doc-1', warnings: [] });
    expect(mocks.uploads).toEqual([{ organizationId: 'org-1', fileName: 'guide.pdf' }]);
    expect(mocks.inserted).toEqual(expect.arrayContaining([
      expect.objectContaining({
        table: 'knowledge_documents',
        rows: [expect.objectContaining({
          body: '',
          file_url: 'https://files.test/guide.pdf',
          file_key: 'org-1/documents/guide.pdf',
        })],
      }),
      expect.objectContaining({
        table: 'audit_logs',
        rows: [expect.objectContaining({
          action: 'knowledge_document_created',
          resource_id: 'doc-1',
        })],
      }),
      expect.objectContaining({
        table: 'support_jobs',
        rows: [expect.objectContaining({
          job_type: 'process_knowledge_document',
          payload: {
            documentId: 'doc-1',
            revision: expect.any(String),
          },
          idempotency_key: expect.stringContaining('revision'),
        })],
      }),
    ]));
  });

  it('rolls back an uploaded file when the document insert fails', async () => {
    mocks.documentInsertError = { message: 'document write failed' };
    const file = new File(['guide'], 'guide.pdf', { type: 'application/pdf' });

    await expect(createKnowledgeDocument({
      organizationId: 'org-1',
      actorId: 'user-1',
      document: { title: 'Guide', sourceType: 'manual', body: '', file },
    })).rejects.toThrow('document write failed (upload rolled back)');

    expect(mocks.rollbackCalls).toEqual([{
      fileKey: 'org-1/documents/guide.pdf',
      primaryError: 'document write failed',
    }]);
    expect(mocks.inserted.map(({ table }) => table)).not.toContain('support_jobs');
    expect(mocks.inserted.map(({ table }) => table)).not.toContain('audit_logs');
  });

  it('returns both warnings after a durable document write succeeds', async () => {
    mocks.auditError = { message: 'audit unavailable' };
    mocks.jobError = { message: 'queue unavailable' };

    const result = await createKnowledgeDocument({
      organizationId: 'org-1',
      actorId: 'user-1',
      document: { title: 'FAQ', sourceType: 'faq', body: 'Answer', file: null },
    });

    expect(result.warnings).toEqual([
      'audit logging failed: audit unavailable',
      'processing could not be queued: queue unavailable',
    ]);
    expect(mocks.rollbackCalls).toHaveLength(0);
  });

  it('treats a duplicate active processing job as already queued', async () => {
    mocks.jobError = {
      code: '23505',
      message: 'duplicate key value violates unique constraint',
    };

    const result = await reprocessKnowledgeDocument({
      document,
      actorId: 'user-1',
    });

    expect(result.warnings).toEqual([]);
  });

  it('uses a new revision key so an edit is queued behind claimed old content', async () => {
    await updateKnowledgeDocument({
      document,
      actorId: 'user-1',
      title: 'First revision',
      sourceType: 'manual',
      body: 'First body',
    });
    await updateKnowledgeDocument({
      document,
      actorId: 'user-1',
      title: 'Second revision',
      sourceType: 'manual',
      body: 'Second body',
    });

    const jobs = mocks.inserted
      .filter(({ table }) => table === 'support_jobs')
      .map(({ rows }) => rows[0] as {
        payload: { revision: string };
        idempotency_key: string;
      });
    expect(jobs).toHaveLength(2);
    expect(jobs[0].payload.revision).not.toBe(jobs[1].payload.revision);
    expect(jobs[0].idempotency_key).not.toBe(jobs[1].idempotency_key);
  });

  it('shares update and reprocess audit-and-queue orchestration', async () => {
    await updateKnowledgeDocument({
      document,
      actorId: 'user-1',
      title: 'Updated guide',
      sourceType: 'article',
      body: 'Updated body',
    });
    await reprocessKnowledgeDocument({ document, actorId: 'user-1' });

    expect(mocks.updated).toEqual([
      expect.objectContaining({
        id: 'doc-1',
        values: expect.objectContaining({ title: 'Updated guide', status: 'pending' }),
      }),
      expect.objectContaining({
        id: 'doc-1',
        values: expect.objectContaining({ status: 'pending', error_message: null }),
      }),
    ]);
    expect(mocks.inserted.filter(({ table }) => table === 'support_jobs')).toHaveLength(2);
    expect(mocks.inserted.filter(({ table }) => table === 'audit_logs')).toHaveLength(2);
  });

  it('keeps deletion durable while reporting storage and audit cleanup warnings', async () => {
    mocks.auditError = { message: 'audit unavailable' };
    mocks.removeError = new Error('storage unavailable');

    const result = await deleteKnowledgeDocument({ document, actorId: 'user-1' });

    expect(mocks.deleted).toEqual([{ table: 'knowledge_documents', id: 'doc-1' }]);
    expect(mocks.removedFileKeys).toEqual(['org-1/documents/guide.pdf']);
    expect(result.warnings).toEqual([
      'audit logging failed: audit unavailable',
      'stored file cleanup failed: storage unavailable',
    ]);
  });
});
