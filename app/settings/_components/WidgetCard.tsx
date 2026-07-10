'use client';

import { useState } from 'react';
import { insforge } from '@/lib/insforge';
import type { WebchatWidgetRow } from './useWebchatWidgets';
import { EmbedSnippet } from './EmbedSnippet';
import { DeleteWidgetModal } from './DeleteWidgetModal';

interface WidgetCardProps {
  widget: WebchatWidgetRow;
  onRefresh: () => void;
  onDelete: (widgetId: string) => Promise<void>;
  readOnly?: boolean;
}

export function WidgetCard({ widget, onRefresh, onDelete, readOnly = false }: WidgetCardProps) {
  const [showSnippet, setShowSnippet] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
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

  const handleConfirmDelete = async () => {
    // The hook's deleteWidget already calls refresh() on success — don't double-fetch.
    await onDelete(widget.id);
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
        {!readOnly && <div className="flex items-center gap-2">
          <button
            type="button"
            role="switch"
            onClick={handleToggleActive}
            disabled={toggling}
            aria-checked={widget.is_active}
            aria-label={widget.is_active ? 'Disable widget' : 'Enable widget'}
            title={widget.is_active ? 'Click to disable' : 'Click to enable'}
            className={`relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full border transition-colors duration-200 focus:outline-none focus:ring-1 focus:ring-[var(--m03-fg)] disabled:opacity-50 ${
              widget.is_active
                ? 'border-[var(--m03-green)] bg-[var(--m03-green)]'
                : 'border-[var(--m03-line)] bg-[var(--m03-line-2)]'
            }`}
          >
            <span
              aria-hidden
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${
                widget.is_active ? 'translate-x-[16px]' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>}
      </div>

      <div className="mt-3 flex items-center gap-3 font-mono text-[10px] text-[var(--m03-fg-3)]">
        <span className="flex items-center gap-1">
          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: widget.primary_color ?? '#2563eb' }} />
          {widget.primary_color ?? '#2563eb'}
        </span>
        <span>{widget.position}</span>
        {widget.pre_chat_enabled && <span>Pre-chat enabled</span>}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setShowSnippet(!showSnippet)}
          className="rounded-md border border-[var(--m03-line)] bg-white px-3 py-1.5 text-[12px] font-medium text-[var(--m03-fg)] transition-colors hover:bg-[var(--m03-line-2)]"
        >
          {showSnippet ? 'Hide snippet' : 'Embed snippet'}
        </button>
        {!readOnly && (
          <button
            type="button"
            onClick={() => setShowDelete(true)}
            className="rounded-md border border-transparent px-3 py-1.5 text-[12px] font-medium text-[var(--m03-red)] transition-colors hover:bg-[var(--m03-red-fill)]"
          >
            Delete
          </button>
        )}
      </div>

      {showSnippet && <EmbedSnippet widget={widget} />}
      {showDelete && (
        <DeleteWidgetModal
          widgetName={widget.name}
          onClose={() => setShowDelete(false)}
          onConfirm={handleConfirmDelete}
        />
      )}
    </div>
  );
}
