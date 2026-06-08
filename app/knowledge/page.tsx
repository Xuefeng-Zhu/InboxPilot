'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRealtime } from '@/lib/use-realtime';
import { insforge } from '@/lib/insforge';
import { AppShell } from '@/components/layout';
import { Button, Card, StatusBadge } from '@/components/ui';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface KnowledgeDocument {
  id: string;
  organization_id: string;
  title: string;
  source_type: string;
  body: string;
  status: 'pending' | 'processing' | 'ready' | 'failed';
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

const SOURCE_TYPES = ['faq', 'article', 'policy', 'manual', 'other'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapStatusToBadge(status: KnowledgeDocument['status']): 'open' | 'resolved' | 'ai_draft' | 'escalated' {
  switch (status) {
    case 'ready':
      return 'resolved';
    case 'processing':
      return 'ai_draft';
    case 'pending':
      return 'open';
    case 'failed':
      return 'escalated';
    default:
      return 'open';
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function KnowledgePage() {
  const { user, loading: authLoading } = useAuth();

  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Add document form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newSourceType, setNewSourceType] = useState('faq');
  const [newBody, setNewBody] = useState('');
  const [adding, setAdding] = useState(false);

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Fetch documents
  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await insforge.database
        .from('knowledge_documents')
        .select()
        .order('created_at', { ascending: false });

      if (fetchError) {
        setError(fetchError.message);
        return;
      }
      setDocuments(Array.isArray(data) ? (data as KnowledgeDocument[]) : []);
    } catch {
      setError('Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && user) {
      fetchDocuments();
    } else if (!authLoading && !user) {
      setLoading(false);
    }
  }, [authLoading, user, fetchDocuments]);

  // Poll for knowledge document status updates every 5 seconds
  useRealtime({
    onKnowledgeDocumentUpdated: fetchDocuments,
    enabled: !authLoading && !!user,
  });

  // Add document
  const handleAddDocument = async () => {
    if (!newTitle.trim() || !newBody.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const { data: insertedData, error: insertError } = await insforge.database
        .from('knowledge_documents')
        .insert({
          title: newTitle.trim(),
          source_type: newSourceType,
          body: newBody.trim(),
          status: 'pending',
        })
        .select();

      if (insertError) {
        setError(insertError.message);
        return;
      }

      // Record audit log entry for knowledge document creation
      const inserted = Array.isArray(insertedData) ? insertedData[0] : insertedData;
      if (inserted) {
        const doc = inserted as Record<string, unknown>;
        await insforge.database
          .from('audit_logs')
          .insert({
            organization_id: doc.organization_id ?? null,
            actor_id: user?.id ?? null,
            actor_type: 'user',
            action: 'knowledge_document_created',
            resource_type: 'knowledge_document',
            resource_id: doc.id ?? null,
            metadata: { title: newTitle.trim() },
          })
          .select();
      }

      setSuccess('Document added successfully');
      setTimeout(() => setSuccess(null), 3000);
      setShowAddForm(false);
      setNewTitle('');
      setNewSourceType('faq');
      setNewBody('');
      await fetchDocuments();
    } catch {
      setError('Failed to add document');
    } finally {
      setAdding(false);
    }
  };

  // Delete document
  const handleDeleteDocument = async (docId: string) => {
    setError(null);
    try {
      const doc = documents.find((d) => d.id === docId);
      // Delete chunks first (cascade should handle this, but be explicit)
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

      // Record audit log entry for knowledge document deletion
      if (doc) {
        await insforge.database
          .from('audit_logs')
          .insert({
            organization_id: doc.organization_id,
            actor_id: user?.id ?? null,
            actor_type: 'user',
            action: 'knowledge_document_deleted',
            resource_type: 'knowledge_document',
            resource_id: docId,
            metadata: { title: doc.title },
          })
          .select();
      }

      setSuccess('Document deleted');
      setTimeout(() => setSuccess(null), 3000);
      setDeletingId(null);
      await fetchDocuments();
    } catch {
      setError('Failed to delete document');
    }
  };

  // Loading state
  if (authLoading || loading) {
    return (
      <AppShell>
        <div className="p-container-margin">
          <h1 className="text-headline-sm text-gray-900">Knowledge Base</h1>
          <p className="mt-4 text-body-md text-gray-500">Loading documents…</p>
        </div>
      </AppShell>
    );
  }

  if (!user) {
    return (
      <AppShell>
        <div className="p-container-margin">
          <h1 className="text-headline-sm text-gray-900">Knowledge Base</h1>
          <p className="mt-4 text-body-md text-red-600">Please sign in to manage the knowledge base.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="p-container-margin max-w-5xl">
        {/* Page header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-headline-sm text-gray-900">Knowledge Base</h1>
            <p className="mt-1 text-body-md text-gray-600">
              Manage documents for AI-powered responses.
            </p>
          </div>
          <Button
            variant={showAddForm ? 'secondary' : 'primary'}
            size="md"
            onClick={() => setShowAddForm(!showAddForm)}
          >
            {showAddForm ? 'Cancel' : 'Add Document'}
          </Button>
        </div>

        {/* Status messages */}
        {error && (
          <div className="mt-4 rounded-md bg-red-50 p-3" role="alert">
            <p className="text-body-md text-red-700">{error}</p>
          </div>
        )}
        {success && (
          <div className="mt-4 rounded-md bg-green-50 p-3" role="status">
            <p className="text-body-md text-green-700">{success}</p>
          </div>
        )}

        {/* Add Document Form */}
        {showAddForm && (
          <Card className="mt-6" header={<h2 className="text-body-md font-medium text-gray-900">Add New Document</h2>}>
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="doc-title" className="block text-label-md text-gray-700">
                    Title
                  </label>
                  <input
                    id="doc-title"
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="e.g. Return Policy FAQ"
                    className="mt-1 block w-full rounded border border-surface-border px-3 py-2 text-body-md placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <div>
                  <label htmlFor="doc-source-type" className="block text-label-md text-gray-700">
                    Source Type
                  </label>
                  <select
                    id="doc-source-type"
                    value={newSourceType}
                    onChange={(e) => setNewSourceType(e.target.value)}
                    className="mt-1 block w-full rounded border border-surface-border px-3 py-2 text-body-md focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    {SOURCE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="doc-body" className="block text-label-md text-gray-700">
                  Content
                </label>
                <textarea
                  id="doc-body"
                  rows={6}
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                  placeholder="Enter the document content…"
                  className="mt-1 block w-full rounded border border-surface-border px-3 py-2 text-body-md placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  size="md"
                  onClick={handleAddDocument}
                  disabled={adding || !newTitle.trim() || !newBody.trim()}
                >
                  {adding ? 'Adding…' : 'Add Document'}
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* Documents List */}
        <div className="mt-6 space-y-element-gap">
          {documents.length === 0 ? (
            <div className="rounded-lg border border-dashed border-surface-border p-8 text-center">
              <p className="text-body-md text-gray-500">No knowledge documents yet.</p>
              <p className="mt-1 text-label-sm text-gray-400">
                Click &quot;Add Document&quot; to upload content for AI-powered responses.
              </p>
            </div>
          ) : (
            documents.map((doc) => (
              <Card key={doc.id}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <h3 className="text-body-md font-medium text-gray-900 truncate">
                        {doc.title}
                      </h3>
                      {doc.status === 'processing' ? (
                        <span className="inline-flex items-center gap-1.5">
                          <svg
                            className="h-3.5 w-3.5 animate-spin text-ai"
                            viewBox="0 0 24 24"
                            fill="none"
                          >
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                            />
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                            />
                          </svg>
                          <span className="text-label-sm text-ai font-medium">Processing</span>
                        </span>
                      ) : (
                        <StatusBadge status={mapStatusToBadge(doc.status)} />
                      )}
                    </div>
                    <p className="mt-1 text-label-sm text-gray-500">
                      Uploaded {formatDate(doc.created_at)} · {doc.source_type}
                    </p>
                    {doc.status === 'failed' && doc.error_message && (
                      <p className="mt-1 text-label-sm text-red-500">{doc.error_message}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {deletingId === doc.id ? (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeletingId(null)}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleDeleteDocument(doc.id)}
                          className="text-red-600 hover:text-red-800"
                        >
                          Confirm Delete
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setDeletingId(doc.id)}
                        aria-label={`Delete ${doc.title}`}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}
