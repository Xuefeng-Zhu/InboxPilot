'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { useKnowledgeDoc, queryKeys } from '@/lib/queries';
import { insforge } from '@/lib/insforge';
import { AppShell } from '@/components/layout';
import { Button } from '@/components/ui';
import { DocumentHeader, DocumentContent } from '@/components/knowledge';

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
        .insert({
          organization_id: doc.organization_id,
          actor_id: user?.id ?? null,
          actor_type: 'user',
          action: 'knowledge_document_updated',
          resource_type: 'knowledge_document',
          resource_id: doc.id,
          metadata: { title: title.trim() },
        })
        .select();

      await insforge.database
        .from('support_jobs')
        .insert({
          organization_id: doc.organization_id,
          job_type: 'process_knowledge_document',
          payload: { documentId: doc.id },
          status: 'pending',
          attempts: 0,
          max_attempts: 3,
          run_after: new Date().toISOString(),
        })
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
        .insert({
          organization_id: doc.organization_id,
          actor_id: user?.id ?? null,
          actor_type: 'user',
          action: 'knowledge_document_deleted',
          resource_type: 'knowledge_document',
          resource_id: doc.id,
          metadata: { title: doc.title },
        })
        .select();

      queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeDocs() });
      router.push('/knowledge');
    } catch {
      setSaveError('Failed to delete document');
    }
  };

  if (isLoading) {
    return (
      <AppShell>
        <div className="p-container-margin">
          <p className="text-body-md text-gray-500">Loading document…</p>
        </div>
      </AppShell>
    );
  }

  if (error || !doc) {
    return (
      <AppShell>
        <div className="p-container-margin">
          <p className="text-body-md text-red-600">{error?.message ?? 'Document not found.'}</p>
          <Button variant="secondary" size="md" onClick={() => router.push('/knowledge')} className="mt-4">
            ← Back to Knowledge Base
          </Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="p-container-margin">
        {/* Breadcrumb */}
        <button
          onClick={() => router.push('/knowledge')}
          className="text-body-sm text-gray-500 hover:text-primary transition-colors"
        >
          ← Back to Knowledge Base
        </button>

        {/* Header */}
        <DocumentHeader
          title={doc.title}
          status={doc.status}
          sourceType={doc.source_type}
          createdAt={doc.created_at}
          updatedAt={doc.updated_at}
          editing={editing}
          editTitle={title}
          onEditTitleChange={setTitle}
          saving={saving}
          onEdit={startEditing}
          onCancel={cancelEditing}
          onSave={handleSave}
          onDelete={handleDelete}
        />

        {/* Messages */}
        {saveError && (
          <div className="mt-4 rounded-md bg-red-50 p-3" role="alert">
            <p className="text-body-sm text-red-700">{saveError}</p>
          </div>
        )}
        {success && (
          <div className="mt-4 rounded-md bg-green-50 p-3" role="status">
            <p className="text-body-sm text-green-700">{success}</p>
          </div>
        )}

        {/* Content */}
        <DocumentContent
          body={doc.body}
          fileName={doc.file_name}
          fileUrl={doc.file_url}
          status={doc.status}
          errorMessage={doc.error_message}
          editing={editing}
          editBody={body}
          editSourceType={sourceType}
          onBodyChange={setBody}
          onSourceTypeChange={setSourceType}
        />
      </div>
    </AppShell>
  );
}
