'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRealtime } from '@/lib/use-realtime';
import { insforge } from '@/lib/insforge';

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

function statusBadgeClasses(status: KnowledgeDocument['status']): string {
  switch (status) {
    case 'ready':
      return 'bg-green-100 text-green-700';
    case 'processing':
      return 'bg-yellow-100 text-yellow-700';
    case 'pending':
      return 'bg-gray-100 text-gray-700';
    case 'failed':
      return 'bg-red-100 text-red-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
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
      const { data, error: fetchError } = await insforge.from<KnowledgeDocument>(
        'knowledge_documents',
        {
          order: 'created_at.desc',
        },
      );
      if (fetchError) {
        setError(fetchError.message);
        return;
      }
      setDocuments(Array.isArray(data) ? data : []);
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
      const { data: insertedData, error: insertError } = await insforge.insert('knowledge_documents', {
        title: newTitle.trim(),
        source_type: newSourceType,
        body: newBody.trim(),
        status: 'pending',
      });
      if (insertError) {
        setError(insertError.message);
        return;
      }

      // Record audit log entry for knowledge document creation
      const inserted = Array.isArray(insertedData) ? insertedData[0] : insertedData;
      if (inserted) {
        const doc = inserted as Record<string, unknown>;
        await insforge.insert('audit_logs', {
          organization_id: doc.organization_id ?? null,
          actor_id: user?.id ?? null,
          actor_type: 'user',
          action: 'knowledge_document_created',
          resource_type: 'knowledge_document',
          resource_id: doc.id ?? null,
          metadata: { title: newTitle.trim() },
        });
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
      await insforge.delete('knowledge_chunks', { document_id: `eq.${docId}` });
      const { error: deleteError } = await insforge.delete('knowledge_documents', {
        id: `eq.${docId}`,
      });
      if (deleteError) {
        setError(deleteError.message);
        return;
      }

      // Record audit log entry for knowledge document deletion
      if (doc) {
        await insforge.insert('audit_logs', {
          organization_id: doc.organization_id,
          actor_id: user?.id ?? null,
          actor_type: 'user',
          action: 'knowledge_document_deleted',
          resource_type: 'knowledge_document',
          resource_id: docId,
          metadata: { title: doc.title },
        });
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
      <main className="min-h-screen p-8">
        <div className="mx-auto max-w-4xl">
          <h1 className="text-2xl font-bold text-gray-900">Knowledge Base</h1>
          <p className="mt-4 text-sm text-gray-500">Loading documents…</p>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-screen p-8">
        <div className="mx-auto max-w-4xl">
          <h1 className="text-2xl font-bold text-gray-900">Knowledge Base</h1>
          <p className="mt-4 text-sm text-red-600">Please sign in to manage the knowledge base.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Knowledge Base</h1>
            <p className="mt-1 text-sm text-gray-600">
              Manage documents for AI-powered responses.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAddForm(!showAddForm)}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            {showAddForm ? 'Cancel' : 'Add Document'}
          </button>
        </div>

        {/* Status messages */}
        {error && (
          <div className="mt-4 rounded-md bg-red-50 p-3" role="alert">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
        {success && (
          <div className="mt-4 rounded-md bg-green-50 p-3" role="status">
            <p className="text-sm text-green-700">{success}</p>
          </div>
        )}

        {/* Add Document Form */}
        {showAddForm && (
          <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-medium text-gray-900">Add New Document</h2>
            <div className="mt-4 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="doc-title" className="block text-sm font-medium text-gray-700">
                    Title
                  </label>
                  <input
                    id="doc-title"
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="e.g. Return Policy FAQ"
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label htmlFor="doc-source-type" className="block text-sm font-medium text-gray-700">
                    Source Type
                  </label>
                  <select
                    id="doc-source-type"
                    value={newSourceType}
                    onChange={(e) => setNewSourceType(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                <label htmlFor="doc-body" className="block text-sm font-medium text-gray-700">
                  Content
                </label>
                <textarea
                  id="doc-body"
                  rows={6}
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                  placeholder="Enter the document content…"
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleAddDocument}
                  disabled={adding || !newTitle.trim() || !newBody.trim()}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {adding ? 'Adding…' : 'Add Document'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Documents List */}
        <div className="mt-6">
          {documents.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center">
              <p className="text-sm text-gray-500">No knowledge documents yet.</p>
              <p className="mt-1 text-xs text-gray-400">
                Click "Add Document" to upload content for AI-powered responses.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-gray-200 shadow-sm">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Title
                    </th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Source Type
                    </th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Status
                    </th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Created
                    </th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Updated
                    </th>
                    <th scope="col" className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {documents.map((doc) => (
                    <tr key={doc.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                        {doc.title}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                        {doc.source_type}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadgeClasses(doc.status)}`}
                        >
                          {doc.status}
                        </span>
                        {doc.status === 'failed' && doc.error_message && (
                          <span className="ml-2 text-xs text-red-500" title={doc.error_message}>
                            ⚠
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                        {formatDate(doc.created_at)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                        {formatDate(doc.updated_at)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-sm">
                        {deletingId === doc.id ? (
                          <span className="inline-flex items-center gap-2">
                            <span className="text-xs text-gray-500">Delete?</span>
                            <button
                              type="button"
                              onClick={() => handleDeleteDocument(doc.id)}
                              className="text-xs font-medium text-red-600 hover:text-red-800 focus:outline-none focus:underline"
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletingId(null)}
                              className="text-xs text-gray-500 hover:text-gray-700 focus:outline-none focus:underline"
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setDeletingId(doc.id)}
                            className="text-xs font-medium text-red-600 hover:text-red-800 focus:outline-none focus:underline"
                            aria-label={`Delete ${doc.title}`}
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
