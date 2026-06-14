'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Input } from '@/components/ui';
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

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !adding) onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, adding]);

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

  const fieldLabel = 'mb-1 block text-[11px] font-medium uppercase tracking-wider text-[var(--m03-fg-2)]';
  const fieldHelp = 'mt-1 text-[12px] text-[var(--m03-fg-3)]';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-doc-title"
        className="w-full max-w-lg overflow-hidden rounded-lg border border-[var(--m03-line)] bg-white shadow-[0_30px_80px_rgba(0,0,0,0.08)]"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--m03-line)] px-6 py-4">
          <h2 id="add-doc-title" className="m-0 text-[16px] font-semibold text-[var(--m03-fg)]">
            Add document
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={adding}
            aria-label="Close"
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded text-[var(--m03-fg-2)] hover:bg-[var(--m03-line-2)] hover:text-[var(--m03-fg)] disabled:opacity-50"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-6 py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="doc-title" className={fieldLabel}>Title</label>
              <input
                id="doc-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Return Policy FAQ"
                className="block w-full rounded-md border border-[var(--m03-line)] bg-white px-3 py-2 text-[13px] text-[var(--m03-fg)] placeholder:text-[var(--m03-fg-3)] focus:border-[var(--m03-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--m03-fg)]"
              />
            </div>
            <div>
              <label htmlFor="doc-source-type" className={fieldLabel}>Source type</label>
              <select
                id="doc-source-type"
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value)}
                className="block w-full rounded-md border border-[var(--m03-line)] bg-white px-3 py-2 text-[13px] text-[var(--m03-fg)] focus:border-[var(--m03-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--m03-fg)]"
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
            <span className={`${fieldLabel} mb-2`}>Content source</span>
            <div className="inline-flex rounded-md border border-[var(--m03-line)] bg-white p-0.5">
              <button
                type="button"
                onClick={() => handleModeSwitch('text')}
                className={`cursor-pointer rounded px-3 py-1 text-[13px] font-medium transition-colors ${
                  mode === 'text'
                    ? 'bg-[var(--m03-fg)] text-[var(--m03-bg)]'
                    : 'text-[var(--m03-fg-2)] hover:text-[var(--m03-fg)]'
                }`}
              >
                Text
              </button>
              <button
                type="button"
                onClick={() => handleModeSwitch('file')}
                className={`cursor-pointer rounded px-3 py-1 text-[13px] font-medium transition-colors ${
                  mode === 'file'
                    ? 'bg-[var(--m03-fg)] text-[var(--m03-bg)]'
                    : 'text-[var(--m03-fg-2)] hover:text-[var(--m03-fg)]'
                }`}
              >
                File upload
              </button>
            </div>
          </div>

          {/* Text mode */}
          {mode === 'text' && (
            <div>
              <label className={`${fieldLabel} mb-1`}>Content</label>
              <MarkdownEditor value={body} onChange={setBody} rows={8} />
            </div>
          )}

          {/* File mode */}
          {mode === 'file' && (
            <div>
              <label htmlFor="doc-file" className={fieldLabel}>Upload file</label>
              {!file ? (
                <div
                  className="mt-1 flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-[var(--m03-line)] p-8 text-center transition-colors hover:border-[var(--m03-fg-2)]"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="mb-2 text-[var(--m03-fg-3)]"
                  >
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  <p className="text-[13px] text-[var(--m03-fg-2)]">
                    Click to choose a file
                  </p>
                  <p className={fieldHelp}>
                    PDF, TXT, Markdown, DOCX, or CSV. Max {MAX_FILE_SIZE_MB}MB.
                  </p>
                </div>
              ) : (
                <div className="mt-1 flex items-center gap-3 rounded-md border border-[var(--m03-line)] p-3">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0 text-[var(--m03-fg-2)]"
                  >
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-[var(--m03-fg)]">{file.name}</p>
                    <p className="text-[12px] text-[var(--m03-fg-3)]">
                      {(file.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    className="shrink-0 cursor-pointer text-[12px] text-[var(--m03-fg-2)] hover:text-[var(--m03-red)]"
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
        <div className="flex justify-end gap-2 border-t border-[var(--m03-line)] px-6 py-4">
          <Button variant="secondary" size="md" onClick={onClose} disabled={adding}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {adding ? 'Adding…' : 'Add document'}
          </Button>
        </div>
      </div>
    </div>
  );
}
