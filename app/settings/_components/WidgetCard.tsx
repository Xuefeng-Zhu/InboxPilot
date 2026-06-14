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
    <div className="rounded-lg border border-[var(--m03-line)] bg-white p-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-[14px] font-medium text-[var(--m03-fg)]">{widget.name}</h3>
          <p className="mt-0.5 font-mono text-[10px] text-[var(--m03-fg-3)]">
            {widget.allowed_domains.length > 0
              ? widget.allowed_domains.join(', ')
              : 'All origins (dev mode)'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-[3px] border px-1.5 py-px font-mono text-[9px] font-semibold uppercase tracking-[0.04em] ${
              widget.is_active
                ? 'border-[var(--m03-green-line)] bg-[var(--m03-green-fill)] text-[var(--m03-green)]'
                : 'border-[var(--m03-line)] bg-white text-[var(--m03-fg-2)]'
            }`}
          >
            {widget.is_active ? 'Active' : 'Inactive'}
          </span>
          <button
            onClick={handleToggleActive}
            disabled={toggling}
            className="text-[12px] text-[var(--m03-fg-2)] transition-colors hover:text-[var(--m03-fg)] disabled:opacity-50"
          >
            {widget.is_active ? 'Disable' : 'Enable'}
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3 font-mono text-[10px] text-[var(--m03-fg-3)]">
        <span className="flex items-center gap-1">
          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: widget.primary_color ?? '#2563eb' }} />
          {widget.primary_color ?? '#2563eb'}
        </span>
        <span>{widget.position}</span>
        {widget.pre_chat_enabled && <span>Pre-chat enabled</span>}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => setShowSnippet(!showSnippet)}
          className="rounded-md border border-[var(--m03-line)] bg-white px-3 py-1.5 text-[12px] font-medium text-[var(--m03-fg)] transition-colors hover:bg-[var(--m03-line-2)]"
        >
          {showSnippet ? 'Hide snippet' : 'Embed snippet'}
        </button>
      </div>

      {showSnippet && <EmbedSnippet widget={widget} />}
    </div>
  );
}
