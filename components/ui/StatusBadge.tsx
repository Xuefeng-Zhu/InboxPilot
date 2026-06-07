import React from 'react';
import { cn } from './cn';

// ---------------------------------------------------------------------------
// StatusBadge — Design-system pill badge for status display
// ---------------------------------------------------------------------------

type Status = 'open' | 'pending' | 'escalated' | 'resolved' | 'ai_draft' | 'connected' | 'disconnected';

interface StatusBadgeProps {
  status: Status;
  className?: string;
}

const colorMap: Record<Status, string> = {
  open: 'bg-orange-50 text-orange-700',
  pending: 'bg-yellow-50 text-yellow-700',
  escalated: 'bg-red-50 text-red-700',
  resolved: 'bg-green-50 text-green-700',
  ai_draft: 'bg-purple-50 text-purple-700',
  connected: 'bg-green-50 text-green-700',
  disconnected: 'bg-red-50 text-red-700',
};

function formatStatus(status: Status): string {
  const withSpaces = status.replace(/_/g, ' ');
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        colorMap[status],
        className
      )}
    >
      {formatStatus(status)}
    </span>
  );
}
