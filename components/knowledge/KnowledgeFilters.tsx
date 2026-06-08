'use client';

import { SOURCE_TYPES } from './types';

interface KnowledgeFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  typeFilter: string;
  onTypeFilterChange: (value: string) => void;
  filteredCount: number;
  totalCount: number;
}

export function KnowledgeFilters({
  search,
  onSearchChange,
  typeFilter,
  onTypeFilterChange,
  filteredCount,
  totalCount,
}: KnowledgeFiltersProps) {
  return (
    <div className="mt-6 flex items-center gap-3 flex-wrap">
      <div className="relative flex-1 min-w-[200px] max-w-sm">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"
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
          placeholder="Search documents..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full rounded border border-surface-border bg-white py-2 pl-9 pr-3 text-body-sm placeholder-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>

      <div className="flex items-center gap-1.5">
        {(['all', ...SOURCE_TYPES] as const).map((filter) => (
          <button
            key={filter}
            onClick={() => onTypeFilterChange(filter)}
            className={`rounded-full px-3 py-1 text-label-sm font-medium transition-colors ${
              typeFilter === filter
                ? 'bg-primary text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {filter === 'all' ? 'All' : filter.charAt(0).toUpperCase() + filter.slice(1)}
          </button>
        ))}
      </div>

      <span className="ml-auto text-body-sm text-gray-500">
        {filteredCount} of {totalCount}
      </span>
    </div>
  );
}
