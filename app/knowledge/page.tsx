'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { useKnowledgeDocs, queryKeys } from '@/lib/queries';
import { insforge } from '@/lib/insforge';
import { AppShell } from '@/components/layout';
import { Button } from '@/components/ui';
import {
  AddDocumentForm,
  KnowledgeFilters,
  KnowledgeTable,
  MAX_FILE_SIZE_MB,
} from '@/components/knowledge';

export default function KnowledgePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: documents = [], isLoading: loading, error: queryError } = useKnowledgeDocs();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form visibility
  const [showAddForm, setShowAddForm] = useState(false);
  const [adding, setAdding] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const refetchDocs = () => queryClient.invalidateQueries({ queryKey: queryKeys.knowledgeDocs() });

  // Filtered documents
  const filteredDocuments = documents.filter((doc) => {
    if (typeFilter !== 'all' && doc.source_type !== typeFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!doc.title.toLowerCase().includes(q) && !doc.body.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Add document handler
  const handleAddDocument = async (data: {
    title: string;
    sourceType: string;
    body: string;
    file: File | null;
  }) => {
    setAdding(true);
    setError(null);
    try {
      let fileUrl: string | null = null;
      let fileName: string | null = null;

      if (data.file) {
        if (data.file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
          setError(`File size must be under ${MAX_FILE_SIZE_MB}MB`);
          setAdding(false);
          return;
        }

        const { data: uploadData, error: uploadError } = await insforge.storage
          .from('knowledge-files')
          .upload(`documents/${Date.now()}-${data.file.name}`, data.file);

        if (uploadError || !uploadData) {
          setError(uploadError?.message ?? 'File upload failed');
          setAdding(false);
          return;
        }

        fileUrl = uploadData.url;
        fileName = data.file.name;
      }

      const { data: insertedData, error: insertError } = await insforge.database
        .from('knowledge_documents')
        .insert([{
          title: data.title,
          source_type: data.sourceType,
          body: data.body || (fileName ?? ''),
          status: 'pending',
          file_url: fileUrl,
          file_name: fileName,
        }])
        .select();

      if (insertError) {
        setError(insertError.message);
        return;
      }

      const inserted = Array.isArray(insertedData) ? insertedData[0] : insertedData;
      if (inserted) {
        const doc = inserted as Record<string, unknown>;

        // Audit log
        await insforge.database
          .from('audit_logs')
          .insert([{
            organization_id: doc.organization_id ?? null,
            actor_id: user?.id ?? null,
            actor_type: 'user',
            action: 'knowledge_document_created',
            resource_type: 'knowledge_document',
            resource_id: doc.id ?? null,
            metadata: { title: data.title },
          }])
          .select();

        // Enqueue processing job
        await insforge.database
          .from('support_jobs')
          .insert([{
            organization_id: doc.organization_id ?? null,
            job_type: 'process_knowledge_document',
            payload: { documentId: doc.id },
            status: 'pending',
            attempts: 0,
            max_attempts: 3,
            run_after: new Date().toISOString(),
          }])
          .select();
      }

      setSuccess('Document added successfully');
      setTimeout(() => setSuccess(null), 3000);
      setShowAddForm(false);
      refetchDocs();
    } catch {
      setError('Failed to add document');
    } finally {
      setAdding(false);
    }
  };

  // Delete document handler
  const handleDeleteDocument = async (docId: string) => {
    setError(null);
    try {
      const doc = documents.find((d) => d.id === docId);

      await insforge.database
        .from('knowledge_chunks')
        .delete()
        .eq('document_id', docId);

      const { error: deleteError } = await insforge.database
        .from('knowledge_documents')
        .delete()
        .eq('id', docId);

      if (deleteError) {
        setError(deleteError.message);
        return;
      }

      if (doc) {
        await insforge.database
          .from('audit_logs')
          .insert([{
            organization_id: doc.organization_id,
            actor_id: user?.id ?? null,
            actor_type: 'user',
            action: 'knowledge_document_deleted',
            resource_type: 'knowledge_document',
            resource_id: docId,
            metadata: { title: doc.title },
          }])
          .select();
      }

      setSuccess('Document deleted');
      setTimeout(() => setSuccess(null), 3000);
      refetchDocs();
    } catch {
      setError('Failed to delete document');
    }
  };

  // Loading state
  if (loading) {
    return (
      <AppShell>
        <div className="p-container-margin">
          <h1 className="text-headline-sm text-gray-900">Knowledge Base</h1>
          <p className="mt-4 text-body-md text-gray-500">Loading documents…</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="p-container-margin">
        {/* Page header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-headline-sm text-gray-900">Knowledge Base</h1>
            <p className="mt-1 text-body-md text-gray-600">
              Manage documents for AI-powered responses.
            </p>
          </div>
          <Button
            variant="primary"
            size="md"
            onClick={() => setShowAddForm(true)}
          >
            Add Document
          </Button>
        </div>

        {/* Status messages */}
        {(error || queryError) && (
          <div className="mt-4 rounded-md bg-red-50 p-3" role="alert">
            <p className="text-body-md text-red-700">{error || queryError?.message}</p>
          </div>
        )}
        {success && (
          <div className="mt-4 rounded-md bg-green-50 p-3" role="status">
            <p className="text-body-md text-green-700">{success}</p>
          </div>
        )}

        {/* Add Document Modal */}
        {showAddForm && (
          <AddDocumentForm
            onSubmit={handleAddDocument}
            onClose={() => setShowAddForm(false)}
            adding={adding}
          />
        )}

        {/* Filters */}
        <KnowledgeFilters
          search={search}
          onSearchChange={setSearch}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          filteredCount={filteredDocuments.length}
          totalCount={documents.length}
        />

        {/* Documents Table */}
        <KnowledgeTable
          documents={filteredDocuments}
          totalCount={documents.length}
          onDelete={handleDeleteDocument}
        />
      </div>
    </AppShell>
  );
}
