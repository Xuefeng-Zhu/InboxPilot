'use client';

import type { ConversationStatus, AiState } from '@support-core/types';

// ---------------------------------------------------------------------------
// Status Badge
// ---------------------------------------------------------------------------

const statusConfig: Record<ConversationStatus, { label: string; className: string }> = {
  open: {
    label: 'Open',
    className: 'bg-orange-50 text-orange-700',
  },
  pending: {
    label: 'Pending',
    className: 'bg-yellow-50 text-yellow-700',
  },
  escalated: {
    label: 'Escalated',
    className: 'bg-red-50 text-red-700',
  },
  resolved: {
    label: 'Resolved',
    className: 'bg-green-50 text-green-700',
  },
};

export function StatusBadge({ status }: { status: ConversationStatus }) {
  const config = statusConfig[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${config.className}`}
    >
      {config.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// AI State Indicator
// ---------------------------------------------------------------------------

const aiStateConfig: Record<AiState, { label: string; className: string; show: boolean }> = {
  idle: { label: '', className: '', show: false },
  thinking: { label: 'AI Thinking', className: 'text-ai-600', show: true },
  drafted: { label: 'AI Draft', className: 'text-ai-600', show: true },
  auto_replied: { label: 'Auto-replied', className: 'text-green-600', show: true },
  needs_human: { label: 'Needs Human', className: 'text-orange-600', show: true },
  failed: { label: 'AI Failed', className: 'text-red-600', show: true },
};

export function AiStateIndicator({ aiState }: { aiState: AiState }) {
  const config = aiStateConfig[aiState];
  if (!config.show) return null;

  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${config.className}`}>
      {aiState === 'thinking' && (
        <svg
          className="h-3 w-3 animate-spin"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      )}
      {config.label}
    </span>
  );
}
