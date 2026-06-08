'use client';

import { useState } from 'react';
import { CustomerSelector } from './CustomerSelector';
import type { ConversationStatus, Channel } from '@support-core/types';

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
  onChange: (filters: InboxFilterState) => void;
  onSearchCommit: () => void;
  onClearAll: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const statusOptions: { id: ConversationStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'All Open' },
  { id: 'pending', label: 'Pending' },
  { id: 'escalated', label: 'Escalated' },
  { id: 'resolved', label: 'Resolved' },
];

const channelOptions: { id: Channel | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'email', label: 'Email' },
  { id: 'sms', label: 'SMS' },
];

// ---------------------------------------------------------------------------
// InboxFilters
// ---------------------------------------------------------------------------

export function InboxFilters({ filters, onChange, onSearchCommit, onClearAll }: InboxFiltersProps) {
  const [showPanel, setShowPanel] = useState(
    !!filters.customerId || filters.channel !== 'all' || filters.search !== ''
  );

  const hasActiveFilters = filters.channel !== 'all' || filters.search.trim() !== '' || !!filters.customerId;

  return (
    <>
      {/* Header with toggle */}
      <header className="flex items-center justify-between border-b border-surface-border px-4 py-3">
        <h1 className="text-headline-sm text-gray-900">
          {filters.customerId ? 'Customer Conversations' : 'Inbox'}
        </h1>
        <button
          onClick={() => setShowPanel(!showPanel)}
          className={`p-1.5 rounded transition-colors ${
            showPanel || hasActiveFilters
              ? 'bg-primary-50 text-primary'
              : 'hover:bg-gray-50 text-gray-500'
          }`}
          aria-label="Toggle filters"
          aria-expanded={showPanel}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 4h12M4 8h8M6 12h4" />
          </svg>
        </button>
      </header>

      {/* Expanded filter panel */}
      {showPanel && (
        <div className="px-4 py-3 border-b border-surface-border bg-gray-50 space-y-3">
          {/* Search */}
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
            <input
              type="search"
              placeholder="Search conversations..."
              value={filters.search}
              onChange={(e) => onChange({ ...filters, search: e.target.value })}
              onBlur={onSearchCommit}
              onKeyDown={(e) => { if (e.key === 'Enter') onSearchCommit(); }}
              className="w-full rounded border border-surface-border bg-white py-1.5 pl-8 pr-3 text-body-sm placeholder-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* Channel */}
          <div>
            <span className="text-label-sm text-gray-500 mb-1.5 block">Channel</span>
            <div className="flex items-center gap-1.5">
              {channelOptions.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => onChange({ ...filters, channel: opt.id })}
                  className={`rounded-full px-2.5 py-0.5 text-label-sm font-medium transition-colors ${
                    filters.channel === opt.id
                      ? 'bg-primary text-white'
                      : 'bg-white border border-surface-border text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Customer */}
          <div>
            <span className="text-label-sm text-gray-500 mb-1.5 block">Customer</span>
            <CustomerSelector
              selectedId={filters.customerId}
              onSelect={(id) => onChange({ ...filters, customerId: id })}
              onClear={() => onChange({ ...filters, customerId: null })}
            />
          </div>

          {/* Clear all */}
          {hasActiveFilters && (
            <button
              onClick={onClearAll}
              className="text-label-sm text-primary hover:text-primary-600 font-medium transition-colors"
            >
              Clear all filters
            </button>
          )}
        </div>
      )}

      {/* Status pills */}
      <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-surface-border overflow-x-auto">
        {statusOptions.map((opt) => (
          <button
            key={opt.id}
            onClick={() => onChange({ ...filters, status: opt.id })}
            className={`shrink-0 rounded-full px-3 py-1 text-label-sm font-medium transition-colors ${
              filters.status === opt.id
                ? 'bg-primary text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </>
  );
}
