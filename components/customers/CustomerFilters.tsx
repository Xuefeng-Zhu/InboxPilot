'use client';

import { Pill } from '@/components/ui';

interface CustomerFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  channelFilter: 'all' | 'email' | 'phone';
  onChannelChange: (value: 'all' | 'email' | 'phone') => void;
  counts: { all: number; email: number; phone: number };
  showAnonymous: boolean;
  onShowAnonymousChange: (value: boolean) => void;
  anonymousCount: number;
}

export function CustomerFilters({
  search,
  onSearchChange,
  channelFilter,
  onChannelChange,
  counts,
  showAnonymous,
  onShowAnonymousChange,
  anonymousCount,
}: CustomerFiltersProps) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="relative w-full max-w-[320px]">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--m03-fg-3)]"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
          />
        </svg>
        <input
          type="search"
          placeholder="Search customers…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full rounded-md border border-[var(--m03-line)] bg-white py-2 pl-9 pr-3 text-[13px] text-[var(--m03-fg)] placeholder:text-[var(--m03-fg-3)] focus:border-[var(--m03-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--m03-fg)]"
        />
      </div>

      <Pill active={channelFilter === 'all'}>
        <button
          type="button"
          onClick={() => onChannelChange('all')}
          style={{ all: 'unset', cursor: 'pointer' }}
        >
          Identified {counts.all}
        </button>
      </Pill>
      <Pill active={channelFilter === 'email'}>
        <button
          type="button"
          onClick={() => onChannelChange('email')}
          style={{ all: 'unset', cursor: 'pointer' }}
        >
          Email {counts.email}
        </button>
      </Pill>
      <Pill active={channelFilter === 'phone'}>
        <button
          type="button"
          onClick={() => onChannelChange('phone')}
          style={{ all: 'unset', cursor: 'pointer' }}
        >
          Phone {counts.phone}
        </button>
      </Pill>

      {anonymousCount > 0 && (
        <label className="ml-auto inline-flex cursor-pointer items-center gap-2 rounded-md border border-[var(--m03-line)] bg-white px-3 py-1.5 text-[12px] text-[var(--m03-fg-2)] transition-colors hover:bg-[var(--m03-line-2)]">
          <input
            type="checkbox"
            checked={showAnonymous}
            onChange={(e) => onShowAnonymousChange(e.target.checked)}
            className="h-3.5 w-3.5 cursor-pointer accent-[var(--m03-fg)]"
            aria-label="Show anonymous contacts"
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.04em] text-[var(--m03-fg-3)]">
            Show anonymous
          </span>
          <span className="font-mono text-[11px] text-[var(--m03-fg)]">{anonymousCount}</span>
        </label>
      )}
    </div>
  );
}
