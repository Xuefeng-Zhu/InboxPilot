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
    <div className="overflow-hidden rounded-md border border-[var(--m03-line)]">
      {/* Tab bar */}
      <div className="flex items-center border-b border-[var(--m03-line)] bg-[var(--m03-line-2)]">
        <button
          type="button"
          onClick={() => setTab('write')}
          className={`cursor-pointer px-3 py-1.5 text-[13px] font-medium transition-colors ${
            tab === 'write'
              ? 'border-b-2 border-[var(--m03-fg)] -mb-px bg-white text-[var(--m03-fg)]'
              : 'text-[var(--m03-fg-2)] hover:text-[var(--m03-fg)]'
          }`}
        >
          Write
        </button>
        <button
          type="button"
          onClick={() => setTab('preview')}
          className={`cursor-pointer px-3 py-1.5 text-[13px] font-medium transition-colors ${
            tab === 'preview'
              ? 'border-b-2 border-[var(--m03-fg)] -mb-px bg-white text-[var(--m03-fg)]'
              : 'text-[var(--m03-fg-2)] hover:text-[var(--m03-fg)]'
          }`}
        >
          Preview
        </button>
        <span className="ml-auto pr-3 text-[12px] text-[var(--m03-fg-3)]">
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
          className="block w-full resize-y bg-white px-3 py-3 font-mono text-[13px] text-[var(--m03-fg)] placeholder:text-[var(--m03-fg-3)] focus:outline-none min-h-[200px]"
        />
      ) : (
        <div className="min-h-[200px] px-3 py-3 text-[13px] text-[var(--m03-fg-2)]">
          {value.trim() ? (
            <MarkdownRenderer content={value} />
          ) : (
            <p className="italic text-[var(--m03-fg-3)]">Nothing to preview</p>
          )}
        </div>
      )}
    </div>
  );
}
