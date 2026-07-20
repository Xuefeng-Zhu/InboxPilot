'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/components/ui/cn';
import {
  invalidateConversationMutationCaches,
  useAiDecision,
  useMessages,
} from '@/lib/queries';
import { getAccessToken } from '@/lib/insforge';
import type { PillDescriptor } from '@/lib/queries/hooks/useSymphony';

interface RiverExpandedPanelProps {
  conversationId: string;
  contactName: string;
  pill: PillDescriptor;
  editMode: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onAcceptedWarning: (warning: string | null) => void;
  onApproved: () => void;
}

interface ApiMessage {
  id: string;
  sender_type?: string;
  body?: string | null;
  subject?: string | null;
  created_at?: string;
}

interface ApproveResponse {
  status: string;
  warning?: string;
  data?: { message?: { id: string } | null };
}

/**
 * Renders the active card's expanded content:
 *   - latest customer message (incoming bubble)
 *   - latest AI draft bubble (if ai_state === 'drafted')
 *   - reasoning row (decision_type + confidence)
 *   - Approve & send / Edit actions
 *
 * Mirrors design-review/concept-04-symphony.html lines 224-262.
 */
export function RiverExpandedPanel({
  conversationId,
  contactName,
  pill,
  editMode,
  onStartEdit,
  onCancelEdit,
  onAcceptedWarning,
  onApproved,
}: RiverExpandedPanelProps) {
  const queryClient = useQueryClient();
  const { data: messages } = useMessages(conversationId);
  const { data: aiDecision } = useAiDecision(conversationId);
  const [editedBody, setEditedBody] = useState<string>('');

  // Seed the edit textarea with the AI draft text on first render
  useEffect(() => {
    if (aiDecision?.response_text && editedBody === '') {
      setEditedBody(aiDecision.response_text);
    }
  }, [aiDecision?.response_text, editedBody]);

  const latestIncoming = (messages ?? []).filter(
    (m) => (m as ApiMessage).sender_type === 'contact',
  ).slice(-1)[0] as ApiMessage | undefined;
  const latestOutgoing = (messages ?? []).filter(
    (m) => (m as ApiMessage).sender_type !== 'contact',
  ).slice(-1)[0] as ApiMessage | undefined;

  const incomingBody = latestIncoming?.body ?? '';
  const aiDraftBody = aiDecision?.response_text ?? latestOutgoing?.body ?? '';

  const conf = aiDecision?.confidence != null ? Math.round(Number(aiDecision.confidence) * 100) : null;
  const reasoning = aiDecision?.reasoning_summary ?? '';

  // Approve & send mutation
  const approve = useMutation({
    mutationFn: async (bodyOverride?: string) => {
      const token = getAccessToken();
      const res = await fetch('/api/functions/approve-ai-draft', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          conversationId,
          aiDecisionId: aiDecision?.id,
          ...(bodyOverride ? { body: bodyOverride } : {}),
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      return (await res.json()) as ApproveResponse;
    },
    onMutate: () => {
      onAcceptedWarning(null);
    },
    onSuccess: (result) => {
      const warning =
        typeof result.warning === 'string' && result.warning.trim()
          ? result.warning.trim()
          : null;
      onAcceptedWarning(warning);
      void invalidateConversationMutationCaches(queryClient, conversationId);
      onApproved();
    },
  });

  const canApprove = pill.tone === 'drafting' && !!aiDecision?.id;

  return (
    <div
      className="mt-2 flex min-h-0 flex-1 flex-col gap-2.5"
      data-testid={`river-expanded-${conversationId}`}
    >
      {/* Customer bubble */}
      {incomingBody && (
        <div className="rounded-md border border-[var(--m03-line)] bg-[var(--m03-line-2)] px-3 py-2.5 text-[12px] leading-[1.5] text-[var(--m03-fg)]">
          {incomingBody}
          <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--m03-fg-3)]">
            {contactName} · {formatTime(latestIncoming?.created_at)}
          </div>
        </div>
      )}

      {/* AI draft bubble */}
      {aiDraftBody && (
        <div
          className={cn(
            'rounded-md border border-l-2 border-[var(--m03-line)] bg-[var(--m03-line-2)] px-3 py-2.5 text-[12px] leading-[1.5] text-[var(--m03-fg)]',
            editMode ? 'border-[var(--m03-fg)]' : 'border-[var(--m03-line)] border-l-[var(--m03-fg)]',
          )}
        >
          {editMode ? (
            <textarea
              value={editedBody}
              onChange={(e) => setEditedBody(e.target.value)}
              rows={4}
              className="w-full resize-none border-0 bg-transparent p-0 text-[12px] leading-[1.5] text-[var(--m03-fg)] focus:outline-none"
              aria-label="Edit AI draft"
            />
          ) : (
            aiDraftBody
          )}
          <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--m03-fg-3)]">
            AI · {formatTime(aiDecision?.created_at)} ·{' '}
            {pill.tone === 'drafting' ? 'awaiting approval' : pill.tone === 'sent' ? 'sent' : pill.text}
          </div>
        </div>
      )}

      {/* Reasoning row */}
      {(reasoning || conf != null) && (
        <div
          className={cn(
            'flex items-center gap-2 rounded-md border border-[var(--m03-line)] bg-[var(--m03-line-2)] px-2.5 py-2 font-mono text-[11px] text-[var(--m03-fg-2)]',
          )}
        >
          <span className="truncate">
            REASONING:{' '}
            {reasoning || `AI ${aiDecision?.decision_type ?? 'respond'} trigger`}
          </span>
          {conf != null && (
            <span className="ml-auto font-semibold text-[var(--m03-green)] tabular-nums">
              {conf}%
            </span>
          )}
        </div>
      )}

      {/* Approve / Edit actions */}
      <div className="mt-auto flex gap-1.5">
        {editMode ? (
          <>
            <button
              type="button"
              onClick={onCancelEdit}
              className="flex-1 rounded border border-[var(--m03-line)] bg-transparent px-2 py-2 text-[12px] font-semibold text-[var(--m03-fg-2)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => approve.mutate(editedBody)}
              disabled={!canApprove || !editedBody.trim() || approve.isPending}
              className="flex-1 rounded border border-[var(--m03-fg)] bg-[var(--m03-fg)] px-2 py-2 text-[12px] font-semibold text-[var(--m03-bg)] disabled:opacity-50"
            >
              {approve.isPending ? 'Sending…' : 'Save & send'}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => approve.mutate(undefined)}
              disabled={!canApprove || approve.isPending}
              className={cn(
                'flex-1 rounded border px-2 py-2 text-[12px] font-semibold',
                canApprove
                  ? 'border-[var(--m03-fg)] bg-[var(--m03-fg)] text-[var(--m03-bg)] hover:bg-[var(--m03-fg-2)]'
                  : 'cursor-not-allowed border-[var(--m03-line)] bg-[var(--m03-line-2)] text-[var(--m03-fg-3)]',
              )}
            >
              {approve.isPending ? 'Sending…' : 'Approve & send'}
            </button>
            <button
              type="button"
              onClick={onStartEdit}
              disabled={!canApprove || !aiDraftBody}
              className="flex-1 rounded border border-[var(--m03-line)] bg-transparent px-2 py-2 text-[12px] font-semibold text-[var(--m03-fg-2)] hover:bg-[var(--m03-line-2)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Edit
            </button>
          </>
        )}
      </div>

      {approve.isError && (
        <p className="text-[11px] text-[var(--m03-red)]" role="alert">
          {approve.error instanceof Error ? approve.error.message : 'Failed to send'}
        </p>
      )}

    </div>
  );
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}
