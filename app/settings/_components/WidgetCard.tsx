'use client';

import { useState } from 'react';
import { insforge } from '@/lib/insforge';
import type { WebchatWidgetRow } from './useWebchatWidgets';
import { EmbedSnippet } from './EmbedSnippet';

interface WidgetCardProps {
  widget: WebchatWidgetRow;
  onRefresh: () => void;
}

export function WidgetCard({ widget, onRefresh }: WidgetCardProps) {
  const [showSnippet, setShowSnippet] = useState(false);
  const [toggling, setToggling] = useState(false);

  const handleToggleActive = async () => {
    setToggling(true);
    await insforge.database
      .from('webchat_widgets')
      .update({ is_active: !widget.is_active, updated_at: new Date().toISOString() })
      .eq('id', widget.id);
    setToggling(false);
    onRefresh();
  };

  return (
    <div className="rounded-lg border border-surface-border bg-white p-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-body-md font-medium text-gray-900">{widget.name}</h3>
          <p className="mt-0.5 text-label-sm text-gray-400">
            {widget.allowed_domains.length > 0
              ? widget.allowed_domains.join(', ')
              : 'All origins (dev mode)'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-label-sm font-medium ${
            widget.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
          }`}>
            {widget.is_active ? 'Active' : 'Inactive'}
          </span>
          <button
            onClick={handleToggleActive}
            disabled={toggling}
            className="text-label-sm text-gray-500 hover:text-gray-700 disabled:opacity-50"
          >
            {widget.is_active ? 'Disable' : 'Enable'}
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3 text-label-sm text-gray-500">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: widget.primary_color ?? '#2563eb' }} />
          {widget.primary_color ?? '#2563eb'}
        </span>
        <span>{widget.position}</span>
        {widget.pre_chat_enabled && <span>Pre-chat enabled</span>}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => setShowSnippet(!showSnippet)}
          className="rounded border border-surface-border px-3 py-1.5 text-label-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          {showSnippet ? 'Hide snippet' : 'Embed snippet'}
        </button>
      </div>

      {showSnippet && <EmbedSnippet widget={widget} />}
    </div>
  );
}
