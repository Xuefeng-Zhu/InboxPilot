'use client';

import { useMemo, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { CustomerSelector } from './CustomerSelector';
import type { ConversationStatus, Channel } from '@support-core/types';
import { cn } from '@/components/ui/cn';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InboxFilterState {
  status: ConversationStatus | 'all';
  channel: Channel | 'all';
  search: string;
  customerId: string | null;
}

interface InboxFiltersProps {
  filters: InboxFilterState;
  counts?: { total: number; escalated: number; drafted: number };
  onChange: (filters: InboxFilterState) => void;
  onSearchCommit: () => void;
  onClearAll: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const statusOptions: { id: ConversationStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'escalated', label: 'Escalated' },
  { id: 'resolved', label: 'Resolved' },
];

const channelOptions: { id: Channel | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'sms', label: 'SMS' },
  { id: 'email', label: 'Email' },
  { id: 'webchat', label: 'Web' },
];

// ---------------------------------------------------------------------------
// InboxFilters
// ---------------------------------------------------------------------------

export function InboxFilters({
  filters,
  counts,
  onChange,
  onSearchCommit,
  onClearAll,
}: InboxFiltersProps) {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(true);

  const hasActiveFilters =
    filters.status !== 'all' ||
    filters.channel !== 'all' ||
    filters.search.trim() !== '' ||
    !!filters.customerId;

  const subline = useMemo(() => {
    if (!counts) return '';
    return `${counts.total} conversations · ${counts.escalated} escalated · ${counts.drafted} AI drafted`;
  }, [counts]);

  return (
    <div className="border-b border-[var(--m03-line)]">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 px-4 py-3">
        <div>
          <h1 className="text-[14px] font-semibold leading-tight tracking-[-0.01em] text-[var(--m03-fg)]">
            {filters.customerId ? 'Customer Conversations' : 'Inbox'}
          </h1>
          {subline && (
            <p className="mt-0.5 font-mono text-[11px] text-[var(--m03-fg-3)]">{subline}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setIsCollapsed((v) => !v)}
          aria-expanded={!isCollapsed}
          aria-controls="inbox-filters-panel"
          aria-label={isCollapsed ? 'Show filters' : 'Hide filters'}
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] text-[var(--m03-fg-2)] transition-colors',
            isCollapsed
              ? 'bg-transparent hover:bg-[var(--m03-line-2)]'
              : 'bg-[var(--m03-fg)]/[0.08] hover:bg-[var(--m03-fg)]/[0.12]'
          )}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      {/* Collapsible filter panel (search + channels + customer + clear all) */}
      {!isCollapsed && (
        <div id="inbox-filters-panel" role="region" aria-label="Inbox filters">
          {/* Search */}
          <div className="px-4 pb-3">
            <input
              type="search"
              value={filters.search}
              onChange={(e) => onChange({ ...filters, search: e.target.value })}
              onBlur={onSearchCommit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onSearchCommit();
                }
              }}
              placeholder="Search conversations…"
              className="h-7 w-full rounded-[5px] border border-[var(--m03-line)] bg-white px-2.5 text-[12px] text-[var(--m03-fg)] placeholder:text-[var(--m03-fg-3)] focus:border-[var(--m03-fg)] focus:outline-none"
            />
          </div>

          {/* Channel pills */}
          <div className="flex flex-wrap items-center gap-1 px-4 pb-3">
            {channelOptions.map((opt) => (
              <button
                key={opt.id}
                onClick={() => onChange({ ...filters, channel: opt.id })}
                className={cn(
                  'h-6 rounded-[3px] border px-2 text-[11px] font-medium transition-colors',
                  filters.channel === opt.id
                    ? 'border-[var(--m03-fg)] bg-[var(--m03-fg)] text-[var(--m03-bg)]'
                    : 'border-[var(--m03-line)] bg-transparent text-[var(--m03-fg-2)] hover:bg-[var(--m03-line-2)]',
                )}
              >
                {opt.label}
              </button>
            ))}

            {/* Customer filter */}
            <div className="ml-1">
              <CustomerSelector
                selectedId={filters.customerId}
                onSelect={(id) => onChange({ ...filters, customerId: id })}
                onClear={() => onChange({ ...filters, customerId: null })}
              />
            </div>

            {hasActiveFilters && (
              <button
                onClick={onClearAll}
                className="ml-auto text-[11px] font-medium text-[var(--m03-fg-2)] underline-offset-2 hover:underline"
              >
                Clear all
              </button>
            )}
          </div>
        </div>
      )}

      {/* Status pills (always visible) */}
      <div className="flex flex-wrap gap-1 px-4 pb-3">
        {statusOptions.map((opt) => (
          <button
            key={opt.id}
            onClick={() => onChange({ ...filters, status: opt.id })}
            className={cn(
              'h-6 rounded-[3px] border px-2 text-[11px] font-medium transition-colors',
              filters.status === opt.id
                ? 'border-[var(--m03-fg)] bg-[var(--m03-fg)] text-[var(--m03-bg)]'
                : 'border-[var(--m03-line)] bg-transparent text-[var(--m03-fg-2)] hover:bg-[var(--m03-line-2)]',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
