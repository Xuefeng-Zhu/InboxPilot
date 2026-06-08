'use client';

import { useState } from 'react';
import { MarkdownRenderer } from './MarkdownRenderer';

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}

export function MarkdownEditor({ value, onChange, rows = 12 }: MarkdownEditorProps) {
  const [tab, setTab] = useState<'write' | 'preview'>('write');

  return (
    <div className="rounded-lg border border-surface-border overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-surface-border bg-gray-50">
        <button
          type="button"
          onClick={() => setTab('write')}
          className={`px-4 py-2 text-label-sm font-medium transition-colors ${
            tab === 'write'
              ? 'text-gray-900 border-b-2 border-primary -mb-px bg-white'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Write
        </button>
        <button
          type="button"
          onClick={() => setTab('preview')}
          className={`px-4 py-2 text-label-sm font-medium transition-colors ${
            tab === 'preview'
              ? 'text-gray-900 border-b-2 border-primary -mb-px bg-white'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Preview
        </button>
        <span className="ml-auto self-center pr-3 text-label-sm text-gray-400">
          Markdown supported
        </span>
      </div>

      {/* Content */}
      {tab === 'write' ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          placeholder="Write your content using Markdown…"
          className="block w-full px-4 py-3 text-body-sm font-mono text-gray-800 placeholder:text-gray-400 focus:outline-none resize-y min-h-[200px]"
        />
      ) : (
        <div className="px-4 py-3 min-h-[200px]">
          {value.trim() ? (
            <MarkdownRenderer content={value} />
          ) : (
            <p className="text-body-sm text-gray-400 italic">Nothing to preview</p>
          )}
        </div>
      )}
    </div>
  );
}
