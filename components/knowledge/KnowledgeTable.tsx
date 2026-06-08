'use client';

import { useState } from 'react';
import Link from 'next/link';
import { StatusBadge } from '@/components/ui';
import { type KnowledgeDocument, mapStatusToBadge, formatDate } from './types';

interface KnowledgeTableProps {
  documents: KnowledgeDocument[];
  totalCount: number;
  onDelete: (docId: string) => void;
}

export function KnowledgeTable({ documents, totalCount, onDelete }: KnowledgeTableProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  return (
    <div className="mt-4">
      {documents.length === 0 ? (
        <div className="rounded-lg border border-dashed border-surface-border p-8 text-center">
          <p className="text-body-md text-gray-500">
            {totalCount === 0 ? 'No knowledge documents yet.' : 'No documents match your filters.'}
          </p>
          <p className="mt-1 text-label-sm text-gray-400">
            {totalCount === 0
              ? 'Click "Add Document" to upload content for AI-powered responses.'
              : 'Try adjusting your search or filter criteria.'}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-surface-border bg-white overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[2fr_1fr_1fr_1.2fr_7rem] gap-4 px-4 py-3 border-b border-surface-border bg-gray-50">
            <span className="text-label-sm text-gray-500 uppercase tracking-wider">Title</span>
            <span className="text-label-sm text-gray-500 uppercase tracking-wider">Type</span>
            <span className="text-label-sm text-gray-500 uppercase tracking-wider">Status</span>
            <span className="text-label-sm text-gray-500 uppercase tracking-wider">Created</span>
            <span className="text-label-sm text-gray-500 uppercase tracking-wider text-right">Actions</span>
          </div>

          {/* Rows */}
          <div>
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="grid grid-cols-[2fr_1fr_1fr_1.2fr_7rem] gap-4 px-4 py-3 border-b border-surface-border/50 hover:bg-gray-50 transition-colors items-center group"
              >
                <div className="min-w-0">
                  <Link
                    href={`/knowledge/${doc.id}`}
                    className="text-body-md font-medium text-gray-900 truncate block hover:text-primary transition-colors"
                  >
                    {doc.title}
                  </Link>
                  {doc.file_name && (
                    <span className="inline-flex items-center gap-1 mt-0.5 text-label-sm text-gray-500">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="shrink-0"
                      >
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                      </svg>
                      {doc.file_url ? (
                        <a
                          href={doc.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="truncate hover:text-primary transition-colors"
                        >
                          {doc.file_name}
                        </a>
                      ) : (
                        <span className="truncate">{doc.file_name}</span>
                      )}
                    </span>
                  )}
                  {doc.status === 'failed' && doc.error_message && (
                    <span className="text-label-sm text-red-500 truncate block mt-0.5">
                      {doc.error_message}
                    </span>
                  )}
                </div>

                <span className="text-body-sm text-gray-600 capitalize">
                  {doc.source_type}
                </span>

                <div>
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

                <span className="text-body-sm text-gray-500">
                  {formatDate(doc.created_at)}
                </span>

                <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                  {deletingId === doc.id ? (
                    <>
                      <button
                        onClick={() => setDeletingId(null)}
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors text-label-sm"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => { onDelete(doc.id); setDeletingId(null); }}
                        className="p-1.5 rounded hover:bg-red-50 text-red-600 hover:text-red-700 transition-colors text-label-sm font-medium"
                      >
                        Confirm
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setDeletingId(doc.id)}
                      title={`Delete ${doc.title}`}
                      aria-label={`Delete ${doc.title}`}
                      className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-red-600 transition-colors"
                    >
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 15 15"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M3 4.5h9M5.5 4.5V3a1 1 0 011-1h2a1 1 0 011 1v1.5M6 7v3.5M9 7v3.5M4 4.5l.5 7.5a1 1 0 001 1h4a1 1 0 001-1l.5-7.5" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-surface-border bg-gray-50">
            <span className="text-body-sm text-gray-500">
              Showing {documents.length} of {totalCount} document{totalCount !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
