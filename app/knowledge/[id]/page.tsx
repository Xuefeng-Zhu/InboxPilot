'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { useKnowledgeDoc, queryKeys } from '@/lib/queries';
import { insforge } from '@/lib/insforge';
import { AppShell } from '@/components/layout';
import { Tag, Select } from '@/components/ui';
import { MarkdownEditor } from '@/components/knowledge/MarkdownEditor';
import { MarkdownRenderer } from '@/components/knowledge/MarkdownRenderer';
import { SOURCE_TYPES } from '@/components/knowledge/types';

export default function KnowledgeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: doc, isLoading, error } = useKnowledgeDoc(id);

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [sourceType, setSourceType] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [chunkCount, setChunkCount] = useState<number | null>(null);
  const [linkedConversations, setLinkedConversations] = useState<
    Array<{ id: string; customer_name: string; updated_at: string }>
  >([]);

  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    (async () => {
      try {
        // Chunk count for the document. The ai_decision_chunks table joins
        // ai_decisions to knowledge_chunks, so we need chunk ids to look up
        // which decisions (and therefore which conversations) cited this doc.
        const { data: chunkRows, count } = await insforge.database
          .from('knowledge_chunks')
          .select('id', { count: 'exact' })
          .eq('document_id', doc.id);
        if (cancelled) return;
        const chunkIds = (Array.isArray(chunkRows) ? chunkRows : []).map(
          (r) => (r as { id: string }).id,
        );
        if (typeof count === 'number') {
          setChunkCount(count);
        } else {
          setChunkCount(chunkIds.length);
        }

        if (chunkIds.length === 0) {
          setLinkedConversations([]);
          return;
        }

        // Linked conversations: ai_decisions that referenced any of this
        // document's chunks, joined to the conversation it belongs to.
        // Ordered by most recent first, deduplicated, capped at 5.
        const { data: links } = await insforge.database
          .from('ai_decision_chunks')
          .select('ai_decisions(id,conversation_id,created_at,conversations(id,customer_name,last_message_at))')
          .in('knowledge_chunk_id', chunkIds)
          .order('created_at', { ascending: false })
          .limit(100);
        if (cancelled || !links) return;

        const seen = new Set<string>();
        const list: Array<{ id: string; customer_name: string; updated_at: string }> = [];
        for (const row of links as unknown as Array<{
          ai_decisions: {
            id: string;
            conversations: { id: string; customer_name: string; last_message_at: string } | null;
          } | null;
        }>) {
          const conv = row.ai_decisions?.conversations;
          if (!conv) continue;
          if (seen.has(conv.id)) continue;
          seen.add(conv.id);
          list.push({
            id: conv.id,
            customer_name: conv.customer_name ?? 'Unknown',
            updated_at: conv.last_message_at,
          });
          if (list.length >= 5) break;
        }
        setLinkedConversations(list);
      } catch {
        // Non-fatal — sidebar is decorative
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc]);

  const startEditing = () => {
    if (!doc) return;
    setTitle(doc.title);
    setSourceType(doc.source_type);
    setBody(doc.body);
    setEditing(true);
    setSaveError(null);
  };

  const cancelEditing = () => {
    setEditing(false);
    setSaveError(null);
  };

  const handleSave = async () => {
    if (!doc || !title.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { error: updateError } = await insforge.database
        .from('knowledge_documents')
        .update({
          title: title.trim(),
          source_type: sourceType,
          body: body.trim(),
          status: 'pending',
          updated_at: new Date().toISOString(),
        })
        .eq('id', doc.id);

      if (updateError) {
        setSaveError(updateError.message);
        return;
      }

      await insforge.database
        .from('audit_logs')
        .insert([{
          organization_id: doc.organization_id,
          actor_id: user?.id ?? null,
          actor_type: 'user',
          action: 'knowledge_document_updated',
          resource_type: 'knowledge_document',
          resource_id: doc.id,
          metadata: { title: title.trim() },
        }])
        .select();

      await insforge.database
        .from('support_jobs')
        .insert([{
          organization_id: doc.organization_id,
          job_type: 'process_knowledge_document',
          payload: { documentId: doc.id },
          status: 'pending',
          attempts: 0,
          max_attempts: 3,
          run_after: new Date().toISOString(),
        }])
        .select();

      setEditing(false);
      setSuccess('Document updated and queued for processing');
      setTimeout(() => setSuccess(null), 3000);
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeDoc(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeDocs() });
    } catch {
      setSaveError('Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!doc) return;
    try {
      await insforge.database.from('knowledge_chunks').delete().eq('document_id', doc.id);
      await insforge.database.from('knowledge_documents').delete().eq('id', doc.id);
      await insforge.database
        .from('audit_logs')
        .insert([{
          organization_id: doc.organization_id,
          actor_id: user?.id ?? null,
          actor_type: 'user',
          action: 'knowledge_document_deleted',
          resource_type: 'knowledge_document',
          resource_id: doc.id,
          metadata: { title: doc.title },
        }])
        .select();

      queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeDocs() });
      router.push('/knowledge');
    } catch {
      setSaveError('Failed to delete document');
    }
  };

  const handleReprocess = async () => {
    if (!doc) return;
    try {
      await insforge.database
        .from('support_jobs')
        .insert([{
          organization_id: doc.organization_id,
          job_type: 'process_knowledge_document',
          payload: { documentId: doc.id },
          status: 'pending',
          attempts: 0,
          max_attempts: 3,
          run_after: new Date().toISOString(),
        }])
        .select();
      setSuccess('Queued for reprocessing');
      setTimeout(() => setSuccess(null), 3000);
    } catch {
      setSaveError('Failed to queue reprocess');
    }
  };

  if (isLoading) {
    return (
      <AppShell>
        <p className="text-[13px] text-[var(--m03-fg-2)]">Loading document…</p>
      </AppShell>
    );
  }

  if (error || !doc) {
    return (
      <AppShell>
        <p className="text-[13px] text-[var(--m03-red)]">{error?.message ?? 'Document not found.'}</p>
        <button
          type="button"
          onClick={() => router.push('/knowledge')}
          className="mt-4 cursor-pointer rounded-md border border-[var(--m03-line)] bg-white px-3 py-1.5 text-[13px] text-[var(--m03-fg)] hover:bg-[var(--m03-line-2)]"
        >
          ← Back to Knowledge
        </button>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div>
        {/* Breadcrumb */}
        <div className="mb-2 flex items-center gap-2 text-[12px] text-[var(--m03-fg-2)]">
          <Link href="/knowledge" className="text-[var(--m03-fg-2)] hover:text-[var(--m03-fg)]">
            Knowledge
          </Link>
          <span>/</span>
          <span className="text-[var(--m03-fg)]">{doc.title}</span>
        </div>

        <div className="mb-4 flex items-center justify-between">
          <div>
            {editing ? (
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="block w-full rounded-md border border-[var(--m03-line)] px-3 py-2 text-[20px] font-medium text-[var(--m03-fg)] focus:border-[var(--m03-fg)] focus:outline-none"
              />
            ) : (
              <h1 className="m-0 text-[24px] font-medium tracking-[-0.02em]">{doc.title}</h1>
            )}
            <p className="mt-1.5 mb-0 flex items-center gap-2 text-[13px] text-[var(--m03-fg-2)]">
              <span className="capitalize">{doc.source_type.split('_').map((p: string) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')}</span>
              <span>·</span>
              <span>last updated {relativeTime(doc.updated_at)}</span>
              <span>·</span>
              <span>{chunkCount ?? 0} chunks</span>
              <span>·</span>
              {doc.status === 'ready' && <Tag status="ready">Ready</Tag>}
              {doc.status === 'processing' && <Tag status="processing">Processing</Tag>}
              {doc.status === 'pending' && <Tag status="draft">Pending</Tag>}
              {doc.status === 'failed' && <Tag status="failed">Failed</Tag>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {editing ? (
              <>
                <button
                  type="button"
                  onClick={cancelEditing}
                  disabled={saving}
                  className="cursor-pointer rounded-md border border-[var(--m03-line)] bg-white px-3 py-1.5 text-[13px] text-[var(--m03-fg)] hover:bg-[var(--m03-line-2)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !title.trim()}
                  className="cursor-pointer rounded-md border border-[var(--m03-fg)] bg-[var(--m03-fg)] px-3 py-1.5 text-[13px] font-medium text-[var(--m03-bg)] hover:bg-[var(--m03-fg-2)] disabled:opacity-60"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleReprocess}
                  className="cursor-pointer rounded-md border border-[var(--m03-line)] bg-white px-3 py-1.5 text-[13px] text-[var(--m03-fg)] hover:bg-[var(--m03-line-2)]"
                >
                  Reprocess
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="cursor-pointer rounded-md border border-[var(--m03-line)] bg-white px-3 py-1.5 text-[13px] text-[var(--m03-fg)] hover:bg-[var(--m03-line-2)]"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={startEditing}
                  className="cursor-pointer rounded-md border border-[var(--m03-fg)] bg-[var(--m03-fg)] px-3 py-1.5 text-[13px] font-medium text-[var(--m03-bg)] hover:bg-[var(--m03-fg-2)]"
                >
                  Edit
                </button>
              </>
            )}
          </div>
        </div>

        {saveError && (
          <div className="mb-4 rounded border border-[var(--m03-red-line)] bg-[var(--m03-red-fill)] p-3 text-[13px] text-[var(--m03-red)]">
            {saveError}
          </div>
        )}
        {success && (
          <div className="mb-4 rounded border border-[var(--m03-green-line)] bg-[var(--m03-green-fill)] p-3 text-[13px] text-[var(--m03-green)]">
            {success}
          </div>
        )}

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_280px]">
          <article className="rounded-lg border border-[var(--m03-line)] bg-white p-[18px] text-[14px] leading-[1.65] text-[var(--m03-fg-2)]">
            {editing ? (
              <div>
                <Select
                  label="Source type"
                  value={sourceType}
                  onValueChange={setSourceType}
                  options={SOURCE_TYPES.map((t) => ({
                    value: t,
                    label: t.charAt(0).toUpperCase() + t.slice(1),
                  }))}
                  className="mb-4 max-w-xs"
                />
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-[var(--m03-fg-2)]">
                  Content
                </label>
                <MarkdownEditor value={body} onChange={setBody} rows={18} />
              </div>
            ) : doc.body ? (
              <MarkdownRenderer content={doc.body} />
            ) : (
              <p className="italic text-[var(--m03-fg-3)]">No text content</p>
            )}

            {doc.status === 'failed' && doc.error_message && (
              <div className="mt-4 rounded border border-[var(--m03-red-line)] bg-[var(--m03-red-fill)] p-3 text-[13px] text-[var(--m03-red)]">
                {doc.error_message}
              </div>
            )}
          </article>

          <aside className="flex flex-col gap-3">
            <div className="rounded-lg border border-[var(--m03-line)] bg-white p-[18px]">
              <h3 className="m-0 mb-2.5 text-[11px] font-medium uppercase tracking-wider text-[var(--m03-fg-2)]">
                Metadata
              </h3>
              <div className="flex flex-col gap-1.5 text-[12px]">
                <MetaRow label="Source type" value={doc.source_type} />
                <MetaRow label="Chunks" value={String(chunkCount ?? '—')} />
                <MetaRow label="Embedding model" value="openai/text-embedding-3-small" mono />
                <MetaRow label="Status" value={doc.status} />
              </div>
            </div>
            <div className="rounded-lg border border-[var(--m03-line)] bg-white p-[18px]">
              <h3 className="m-0 mb-2.5 text-[11px] font-medium uppercase tracking-wider text-[var(--m03-fg-2)]">
                Linked conversations
              </h3>
              {linkedConversations.length === 0 ? (
                <p className="text-[12px] text-[var(--m03-fg-3)]">None yet</p>
              ) : (
                <div className="flex flex-col gap-1.5 text-[12px]">
                  {linkedConversations.map((c) => (
                    <Link
                      key={c.id}
                      href={`/inbox?conversation=${c.id}`}
                      className="text-[var(--m03-fg)] hover:underline"
                    >
                      {c.id.slice(0, 12)} · {c.customer_name} · {relativeTime(c.updated_at)}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[var(--m03-fg-2)]">{label}</span>
      <span
        className={`text-[var(--m03-fg)] ${mono ? 'font-mono text-[11px]' : ''} capitalize`}
      >
        {value}
      </span>
    </div>
  );
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
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
