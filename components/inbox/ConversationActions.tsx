'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ConversationStatus } from '@support-core/types';
import { readResponseJsonObject } from '@/lib/http-json';
import { getAccessToken } from '@/lib/insforge';
import { invalidateConversationMutationCaches } from '@/lib/queries';

type ConversationAction = 'escalate' | 'resolve' | 'reopen';

const ACTIONS_BY_STATUS: Record<ConversationStatus, ConversationAction[]> = {
  open: ['escalate', 'resolve'],
  escalated: ['resolve'],
  resolved: ['reopen'],
};

const ACTION_LABELS: Record<ConversationAction, string> = {
  escalate: 'Escalate',
  resolve: 'Resolve',
  reopen: 'Reopen',
};

const ACTION_ICONS: Record<ConversationAction, string> = {
  escalate: '!',
  resolve: '✓',
  reopen: '↺',
};

interface ConversationActionsProps {
  conversationId: string;
  status: ConversationStatus;
}

export function ConversationActions({ conversationId, status }: ConversationActionsProps) {
  const queryClient = useQueryClient();
  const [acceptedWarning, setAcceptedWarning] = useState<string | null>(null);

  useEffect(() => {
    setAcceptedWarning(null);
  }, [conversationId]);

  const mutation = useMutation({
    mutationFn: async (action: ConversationAction) => {
      const token = getAccessToken();
      const response = await fetch(`/api/functions/${action}-conversation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ conversationId }),
      });
      const result = await readResponseJsonObject(
        response,
        `${action}-conversation response`,
      );
      if (!response.ok) {
        throw new Error(
          typeof result.error === 'string'
            ? result.error
            : `Failed to ${action} conversation`,
        );
      }
      return result;
    },
    onMutate: () => {
      setAcceptedWarning(null);
    },
    onSuccess: async (result) => {
      setAcceptedWarning(
        typeof result.warning === 'string' && result.warning.trim()
          ? result.warning
          : null,
      );
      await invalidateConversationMutationCaches(queryClient, conversationId);
    },
  });

  const actions = ACTIONS_BY_STATUS[status];
  const error = mutation.error
    ? mutation.error instanceof Error
      ? mutation.error.message
      : 'Conversation action failed'
    : null;

  return (
    <div className="relative flex shrink-0 items-center gap-1" aria-busy={mutation.isPending}>
      {actions.map((action) => (
        <button
          key={action}
          type="button"
          onClick={() => mutation.mutate(action)}
          disabled={mutation.isPending}
          className="inline-flex h-7 w-7 items-center justify-center rounded border border-[var(--m03-line)] bg-white text-[12px] font-medium text-[var(--m03-fg-2)] transition-colors hover:bg-[var(--m03-line-2)] disabled:cursor-wait disabled:opacity-50 sm:w-auto sm:px-2.5"
          aria-label={`${ACTION_LABELS[action]} conversation`}
          title={`${ACTION_LABELS[action]} conversation`}
        >
          <span aria-hidden="true" className="sm:hidden">{ACTION_ICONS[action]}</span>
          <span className="hidden sm:inline">{ACTION_LABELS[action]}</span>
        </button>
      ))}

      {(error || acceptedWarning) && (
        <div
          role="alert"
          className={`absolute right-0 top-9 z-20 w-64 rounded border bg-white px-3 py-2 text-[11px] shadow-md ${
            error
              ? 'border-[var(--m03-red-line)] text-[var(--m03-red)]'
              : 'border-[var(--m03-orange-line)] text-[var(--m03-orange)]'
          }`}
        >
          {error ?? acceptedWarning}
        </div>
      )}
    </div>
  );
}
