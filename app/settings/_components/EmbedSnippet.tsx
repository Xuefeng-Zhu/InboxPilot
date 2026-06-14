'use client';

import { useState } from 'react';
import type { WebchatWidgetRow } from './useWebchatWidgets';

interface EmbedSnippetProps {
  widget: WebchatWidgetRow;
}

export function EmbedSnippet({ widget }: EmbedSnippetProps) {
  const [copied, setCopied] = useState(false);

  const appUrl = typeof window !== 'undefined' ? window.location.origin : 'https://app.inboxpilot.com';
  const snippet = `<script src="${appUrl}/widget.js" data-widget-id="${widget.widget_token}" data-position="${widget.position}" data-color="${widget.primary_color ?? '#2563eb'}"></script>`;

  const handleCopy = () => {
    navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mt-3">
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-[var(--m03-line)] bg-[var(--m03-line-2)] p-3 font-mono text-[12px] text-[var(--m03-fg-2)]">
        {snippet}
      </pre>
      <button
        onClick={handleCopy}
        className="mt-2 text-[12px] font-medium text-[var(--m03-fg)] transition-colors hover:underline"
      >
        {copied ? '✓ Copied!' : 'Copy snippet'}
      </button>
    </div>
  );
}
