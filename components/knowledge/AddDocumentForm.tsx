'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { SOURCE_TYPES, ACCEPTED_FILE_TYPES, MAX_FILE_SIZE_MB } from './types';
import { MarkdownEditor } from './MarkdownEditor';

type InputMode = 'text' | 'file';

interface AddDocumentFormProps {
  onSubmit: (data: {
    title: string;
    sourceType: string;
    body: string;
    file: File | null;
  }) => Promise<void>;
  onClose: () => void;
  adding: boolean;
}

export function AddDocumentForm({ onSubmit, onClose, adding }: AddDocumentFormProps) {
  const [title, setTitle] = useState('');
  const [sourceType, setSourceType] = useState('faq');
  const [body, setBody] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<InputMode>('text');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const canSubmit =
    title.trim() &&
    ((mode === 'text' && body.trim()) || (mode === 'file' && file)) &&
    !adding;

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !adding) onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, adding]);

  // Focus first input on mount
  useEffect(() => {
    dialogRef.current?.querySelector<HTMLInputElement>('input')?.focus();
  }, []);

  const handleModeSwitch = (newMode: InputMode) => {
    setMode(newMode);
    if (newMode === 'text') {
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } else {
      setBody('');
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    await onSubmit({
      title: title.trim(),
      sourceType,
      body: mode === 'text' ? body.trim() : '',
      file: mode === 'file' ? file : null,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-doc-title"
        className="w-full max-w-lg rounded-lg border border-surface-border bg-white shadow-level-2 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-surface-border px-6 py-4">
          <h2 id="add-doc-title" className="text-headline-sm text-gray-900">
            Add Document
          </h2>
          <button
            onClick={onClose}
            disabled={adding}
            className="rounded p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="doc-title" className="block text-label-md text-gray-700">
                Title
              </label>
              <input
                id="doc-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
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
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value)}
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

          {/* Mode toggle */}
          <div>
            <span className="block text-label-md text-gray-700 mb-2">Content Source</span>
            <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1 w-fit">
              <button
                type="button"
                onClick={() => handleModeSwitch('text')}
                className={`rounded-md px-3 py-1.5 text-label-sm font-medium transition-colors ${
                  mode === 'text'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Text
              </button>
              <button
                type="button"
                onClick={() => handleModeSwitch('file')}
                className={`rounded-md px-3 py-1.5 text-label-sm font-medium transition-colors ${
                  mode === 'file'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                File Upload
              </button>
            </div>
          </div>

          {/* Text mode */}
          {mode === 'text' && (
            <div>
              <label className="block text-label-md text-gray-700 mb-1">
                Content
              </label>
              <MarkdownEditor value={body} onChange={setBody} rows={8} />
            </div>
          )}

          {/* File mode */}
          {mode === 'file' && (
            <div>
              <label htmlFor="doc-file" className="block text-label-md text-gray-700">
                Upload File
              </label>
              {!file ? (
                <div
                  className="mt-1 flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-surface-border p-8 text-center hover:border-primary/40 transition-colors cursor-pointer"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <svg
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-gray-400 mb-2"
                  >
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  <p className="text-body-sm text-gray-600">
                    Click to choose a file
                  </p>
                  <p className="mt-1 text-label-sm text-gray-400">
                    PDF, TXT, Markdown, DOCX, or CSV. Max {MAX_FILE_SIZE_MB}MB.
                  </p>
                </div>
              ) : (
                <div className="mt-1 flex items-center gap-3 rounded-lg border border-surface-border p-3">
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
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <p className="text-body-sm font-medium text-gray-900 truncate">{file.name}</p>
                    <p className="text-label-sm text-gray-400">
                      {(file.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    className="text-label-sm text-gray-500 hover:text-red-600 transition-colors shrink-0"
                  >
                    Remove
                  </button>
                </div>
              )}
              <input
                ref={fileInputRef}
                id="doc-file"
                type="file"
                accept={ACCEPTED_FILE_TYPES}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="hidden"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-surface-border px-6 py-4">
          <Button variant="secondary" size="md" onClick={onClose} disabled={adding}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {adding ? 'Adding…' : 'Add Document'}
          </Button>
        </div>
      </div>
    </div>
  );
}
