'use client';

import { MarkdownEditor } from './MarkdownEditor';
import { MarkdownRenderer } from './MarkdownRenderer';
import { SOURCE_TYPES } from './types';

interface DocumentContentProps {
  body: string;
  fileName: string | null;
  fileUrl: string | null;
  status: string;
  errorMessage: string | null;
  editing: boolean;
  editBody: string;
  editSourceType: string;
  onBodyChange: (value: string) => void;
  onSourceTypeChange: (value: string) => void;
}

export function DocumentContent({
  body,
  fileName,
  fileUrl,
  status,
  errorMessage,
  editing,
  editBody,
  editSourceType,
  onBodyChange,
  onSourceTypeChange,
}: DocumentContentProps) {
  return (
    <>
      {/* File attachment */}
      {fileName && (
        <div className="mt-6 flex items-center gap-3 rounded-lg border border-surface-border p-3">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-primary shrink-0"
          >
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-body-sm font-medium text-gray-900 truncate">{fileName}</p>
          </div>
          {fileUrl && (
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-label-sm text-primary hover:text-primary-600 transition-colors shrink-0"
            >
              Download
            </a>
          )}
        </div>
      )}

      {/* Source type (editing) */}
      {editing && (
        <div className="mt-6">
          <label htmlFor="detail-source-type" className="block text-label-md text-gray-700">
            Source Type
          </label>
          <select
            id="detail-source-type"
            value={editSourceType}
            onChange={(e) => onSourceTypeChange(e.target.value)}
            className="mt-1 block w-full max-w-xs rounded border border-surface-border px-3 py-2 text-body-md focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            {SOURCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Body content */}
      <div className="mt-6">
        <h2 className="text-label-md text-gray-700 mb-2">Content</h2>
        {editing ? (
          <MarkdownEditor value={editBody} onChange={onBodyChange} rows={14} />
        ) : (
          <div className="rounded-lg border border-surface-border bg-white p-5">
            {body ? (
              <MarkdownRenderer content={body} />
            ) : (
              <p className="text-body-sm text-gray-400 italic">No text content</p>
            )}
          </div>
        )}
      </div>

      {/* Error info */}
      {status === 'failed' && errorMessage && (
        <div className="mt-6 rounded-md bg-red-50 border border-red-100 p-4">
          <h3 className="text-label-md font-medium text-red-800">Processing Error</h3>
          <p className="mt-1 text-body-sm text-red-700">{errorMessage}</p>
        </div>
      )}
    </>
  );
}
