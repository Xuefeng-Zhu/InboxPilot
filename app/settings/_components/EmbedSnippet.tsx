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
      <pre className="rounded bg-gray-50 border border-surface-border p-3 text-xs font-mono text-gray-700 overflow-x-auto whitespace-pre-wrap break-all">
        {snippet}
      </pre>
      <button
        onClick={handleCopy}
        className="mt-2 text-label-sm font-medium text-primary hover:text-primary-600 transition-colors"
      >
        {copied ? '✓ Copied!' : 'Copy snippet'}
      </button>
    </div>
  );
}
