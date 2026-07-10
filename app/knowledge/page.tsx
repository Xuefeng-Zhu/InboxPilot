'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { useCurrentMembership, useKnowledgeDocs, queryKeys } from '@/lib/queries';
import { insforge } from '@/lib/insforge';
import { AppShell } from '@/components/layout';
import { Pill, Tag } from '@/components/ui';
import {
  AddDocumentForm,
  MAX_FILE_SIZE_MB,
  type KnowledgeDocument,
  SOURCE_TYPES,
} from '@/components/knowledge';
import {
  removeKnowledgeFile,
  rollbackKnowledgeUpload,
  uploadKnowledgeFile,
} from './storage';

type TypeFilter = 'all' | (typeof SOURCE_TYPES)[number];

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  return new Date(iso).toLocaleDateString();
}

function sourceTypeLabel(t: string): string {
  return t
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export default function KnowledgePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const {
    data: membership,
    error: membershipError,
  } = useCurrentMembership(user?.id);
  const canManageKnowledge = membership?.role === 'owner' || membership?.role === 'admin';

  const { data: documents = [], isLoading: loading, error: queryError } = useKnowledgeDocs();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [adding, setAdding] = useState(false);

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  const [chunkCounts, setChunkCounts] = useState<Record<string, number>>({});

  const refetchDocs = () => queryClient.invalidateQueries({
    queryKey: queryKeys.knowledgeDocs(membership?.organizationId ?? ''),
  });

  useEffect(() => {
    if (documents.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error: chunkError } = await insforge.database
          .from('knowledge_chunks')
          .select('document_id')
          .in(
            'document_id',
            documents.map((d) => d.id),
          );
        if (chunkError) throw new Error(chunkError.message);
        if (cancelled || !data) return;
        const counts: Record<string, number> = {};
        for (const row of data as Array<{ document_id: string }>) {
          counts[row.document_id] = (counts[row.document_id] ?? 0) + 1;
        }
        if (!cancelled) setChunkCounts(counts);
      } catch {
        // Non-fatal: chunk counts are decorative
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [documents]);

  const filteredDocuments = documents.filter((doc) => {
    if (typeFilter !== 'all' && doc.source_type !== typeFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!doc.title.toLowerCase().includes(q) && !doc.body.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const handleAddDocument = async (data: {
    title: string;
    sourceType: string;
    body: string;
    file: File | null;
  }) => {
    if (!user || !membership || !canManageKnowledge) {
      setError('Only organization owners and admins can add knowledge documents.');
      return;
    }
    setAdding(true);
    setError(null);
    let fileKey: string | null = null;
    let documentPersisted = false;
    try {
      let fileUrl: string | null = null;
      let fileName: string | null = null;

      if (data.file) {
        if (data.file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
          setError(`File size must be under ${MAX_FILE_SIZE_MB}MB`);
          setAdding(false);
          return;
        }

        const uploadedFile = await uploadKnowledgeFile(
          membership.organizationId,
          data.file,
        );
        fileUrl = uploadedFile.url;
        fileName = data.file.name;
        fileKey = uploadedFile.key;
      }

      const { data: insertedData, error: insertError } = await insforge.database
        .from('knowledge_documents')
        .insert([{
          organization_id: membership.organizationId,
          title: data.title,
          source_type: data.sourceType,
          body: data.body || (fileName ?? ''),
          status: 'pending',
          file_url: fileUrl,
          file_name: fileName,
          file_key: fileKey,
        }])
        .select();

      if (insertError) {
        setError(
          fileKey
            ? await rollbackKnowledgeUpload(fileKey, insertError.message)
            : insertError.message,
        );
        return;
      }

      const inserted = Array.isArray(insertedData) ? insertedData[0] : insertedData;
      if (!inserted) {
        const missingRowError = 'Document insert did not return the created row.';
        setError(
          fileKey
            ? await rollbackKnowledgeUpload(fileKey, missingRowError)
            : missingRowError,
        );
        return;
      }
      const doc = inserted as Record<string, unknown>;
      documentPersisted = true;

      const warnings: string[] = [];
      const { error: auditError } = await insforge.database
        .from('audit_logs')
        .insert([{
          organization_id: membership.organizationId,
          actor_id: user.id,
          actor_type: 'user',
          action: 'knowledge_document_created',
          resource_type: 'knowledge_document',
          resource_id: doc.id ?? null,
          metadata: { title: data.title },
        }]);
      if (auditError) warnings.push(`audit logging failed: ${auditError.message}`);

      const { error: jobError } = await insforge.database
        .from('support_jobs')
        .insert([{
          organization_id: membership.organizationId,
          job_type: 'process_knowledge_document',
          payload: { documentId: doc.id },
          status: 'pending',
          attempts: 0,
          max_attempts: 3,
          run_after: new Date().toISOString(),
        }]);
      if (jobError) warnings.push(`processing could not be queued: ${jobError.message}`);

      setShowAddForm(false);
      await refetchDocs();
      if (warnings.length > 0) {
        setError(`Document added, but ${warnings.join('; ')}`);
      } else {
        setSuccess('Document added successfully');
        setTimeout(() => setSuccess(null), 3000);
      }
    } catch (addError) {
      const message = addError instanceof Error ? addError.message : 'Failed to add document';
      setError(
        fileKey && !documentPersisted
          ? await rollbackKnowledgeUpload(fileKey, message)
          : message,
      );
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    if (!user || !canManageKnowledge) {
      setError('Only organization owners and admins can delete knowledge documents.');
      return;
    }
    setError(null);
    try {
      const doc = documents.find((d) => d.id === docId);
      if (!doc) {
        setError('Document not found.');
        return;
      }

      const { error: deleteError } = await insforge.database
        .from('knowledge_documents')
        .delete()
        .eq('id', docId);

      if (deleteError) {
        setError(deleteError.message);
        return;
      }

      const warnings: string[] = [];
      if (doc.file_key) {
        try {
          await removeKnowledgeFile(doc.file_key);
        } catch (storageError) {
          warnings.push(
            `stored file cleanup failed: ${storageError instanceof Error ? storageError.message : 'unknown error'}`,
          );
        }
      }

      const { error: auditError } = await insforge.database
        .from('audit_logs')
        .insert([{
          organization_id: doc.organization_id,
          actor_id: user.id,
          actor_type: 'user',
          action: 'knowledge_document_deleted',
          resource_type: 'knowledge_document',
          resource_id: docId,
          metadata: { title: doc.title },
        }]);
      if (auditError) warnings.push(`audit logging failed: ${auditError.message}`);

      await refetchDocs();
      if (warnings.length > 0) {
        setError(`Document deleted, but ${warnings.join('; ')}`);
      } else {
        setSuccess('Document deleted');
        setTimeout(() => setSuccess(null), 3000);
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete document');
    }
  };

  const readyCount = documents.filter((d) => d.status === 'ready').length;
  const processingCount = documents.filter((d) => d.status === 'processing' || d.status === 'pending').length;

  return (
    <AppShell>
      <div className="flex h-full min-h-0 flex-col">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h1 className="m-0 text-[24px] font-medium tracking-[-0.02em]">Knowledge</h1>
            <p className="mt-1 mb-0 text-[13px] text-[var(--m03-fg-2)]">
              {documents.length} article{documents.length === 1 ? '' : 's'} · {processingCount} processing · {readyCount} ready
            </p>
          </div>
          {canManageKnowledge && (
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
              className="cursor-pointer rounded-md border border-[var(--m03-fg)] bg-[var(--m03-fg)] px-3 py-1.5 text-[13px] font-medium text-[var(--m03-bg)] hover:bg-[var(--m03-fg-2)]"
            >
              + New article
            </button>
          )}
        </div>

        {(error || queryError || membershipError) && (
          <div className="mb-4 rounded border border-[var(--m03-red-line)] bg-[var(--m03-red-fill)] p-3 text-[13px] text-[var(--m03-red)]">
            {error || queryError?.message || membershipError?.message}
          </div>
        )}
        {success && (
          <div className="mb-4 rounded border border-[var(--m03-green-line)] bg-[var(--m03-green-fill)] p-3 text-[13px] text-[var(--m03-green)]">
            {success}
          </div>
        )}

        {showAddForm && canManageKnowledge && (
          <AddDocumentForm
            onSubmit={handleAddDocument}
            onClose={() => setShowAddForm(false)}
            adding={adding}
          />
        )}

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input
            type="search"
            placeholder="Search articles…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-[320px] rounded-md border border-[var(--m03-line)] bg-white px-3 py-2 text-[13px] focus:border-[var(--m03-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--m03-fg)]"
          />
          <Pill active={typeFilter === 'all'}>
            <button
              type="button"
              onClick={() => setTypeFilter('all')}
              style={{ all: 'unset', cursor: 'pointer' }}
            >
              All {documents.length}
            </button>
          </Pill>
          {SOURCE_TYPES.map((t) => {
            const count = documents.filter((d) => d.source_type === t).length;
            return (
              <Pill key={t} active={typeFilter === t}>
                <button
                  type="button"
                  onClick={() => setTypeFilter(t)}
                  style={{ all: 'unset', cursor: 'pointer' }}
                >
                  {sourceTypeLabel(t)} {count}
                </button>
              </Pill>
            );
          })}
        </div>

        {loading ? (
          <p className="text-[13px] text-[var(--m03-fg-2)]">Loading documents…</p>
        ) : filteredDocuments.length === 0 ? (
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-dashed border-[var(--m03-line)] bg-white p-8 text-center">
            <p className="text-[13px] text-[var(--m03-fg-2)]">
              {documents.length === 0
                ? 'No knowledge documents yet.'
                : 'No documents match your filters.'}
            </p>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-[var(--m03-line)] bg-white">
            <table className="w-full min-w-[720px] border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className="sticky top-0 z-10 border-b border-[var(--m03-line)] bg-white px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--m03-fg-2)]">
                    Title
                  </th>
                  <th className="sticky top-0 z-10 border-b border-[var(--m03-line)] bg-white px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--m03-fg-2)]">
                    Type
                  </th>
                  <th className="sticky top-0 z-10 border-b border-[var(--m03-line)] bg-white px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--m03-fg-2)]">
                    Status
                  </th>
                  <th className="sticky top-0 z-10 border-b border-[var(--m03-line)] bg-white px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--m03-fg-2)]">
                    Chunks
                  </th>
                  <th className="sticky top-0 z-10 border-b border-[var(--m03-line)] bg-white px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--m03-fg-2)]">
                    Updated
                  </th>
                  <th className="sticky top-0 z-10 border-b border-[var(--m03-line)] bg-white px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--m03-fg-2)]"></th>
                </tr>
              </thead>
              <tbody>
                {filteredDocuments.map((doc) => (
                  <DocumentRow
                    key={doc.id}
                    doc={doc}
                    chunks={chunkCounts[doc.id]}
                    onDelete={handleDeleteDocument}
                    canManage={canManageKnowledge}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function DocumentRow({
  doc,
  chunks,
  onDelete,
  canManage,
}: {
  doc: KnowledgeDocument;
  chunks: number | undefined;
  onDelete: (id: string) => void;
  canManage: boolean;
}) {
  return (
    <tr className="hover:bg-[var(--m03-line-2)]">
      <td className="border-b border-[var(--m03-line)] px-3 py-3">
        <Link
          href={`/knowledge/${doc.id}`}
          className="font-semibold text-[var(--m03-fg)] hover:underline"
        >
          {doc.title}
        </Link>
      </td>
      <td className="border-b border-[var(--m03-line)] px-3 py-3 text-[var(--m03-fg-2)]">
        {sourceTypeLabel(doc.source_type)}
      </td>
      <td className="border-b border-[var(--m03-line)] px-3 py-3">
        {doc.status === 'ready' && <Tag status="ready">Ready</Tag>}
        {doc.status === 'processing' && <Tag status="processing">Processing</Tag>}
        {doc.status === 'pending' && <Tag status="draft">Pending</Tag>}
        {doc.status === 'failed' && <Tag status="failed">Failed</Tag>}
      </td>
      <td className="border-b border-[var(--m03-line)] px-3 py-3 text-[var(--m03-fg-2)] tabular-nums">
        {chunks ?? '—'}
      </td>
      <td className="border-b border-[var(--m03-line)] px-3 py-3 text-[var(--m03-fg-2)]">
        {relativeTime(doc.updated_at)}
      </td>
      <td className="border-b border-[var(--m03-line)] px-3 py-3 text-right">
        <div className="flex items-center justify-end gap-1">
          <Link
            href={`/knowledge/${doc.id}`}
            title={`Open ${doc.title}`}
            aria-label={`Open ${doc.title}`}
            className="flex h-7 w-7 items-center justify-center rounded text-[var(--m03-fg-2)] hover:bg-[var(--m03-line-2)] hover:text-[var(--m03-fg)]"
          >
            <svg width="14" height="14" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.5 2.5l3 3M2 9l6.5-6.5 3 3L5 12H2V9z" />
            </svg>
          </Link>
          {canManage && (
            <button
              type="button"
              onClick={() => onDelete(doc.id)}
              title={`Delete ${doc.title}`}
              aria-label={`Delete ${doc.title}`}
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-[var(--m03-fg-2)] hover:bg-[var(--m03-line-2)] hover:text-[var(--m03-red)]"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2.5 4h9M5 4V2.5h4V4M3.5 4v8a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1V4" />
                <line x1="6" y1="6.5" x2="6" y2="10.5" />
                <line x1="8" y1="6.5" x2="8" y2="10.5" />
              </svg>
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
