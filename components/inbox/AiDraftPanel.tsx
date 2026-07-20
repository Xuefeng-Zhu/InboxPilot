'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { readResponseJsonObject } from '@/lib/http-json';
import { getAccessToken } from '@/lib/insforge';
import {
  invalidateConversationMutationCaches,
  queryKeys,
  useAiDecision,
} from '@/lib/queries';
import type { AiState } from '@support-core/types';

// ---------------------------------------------------------------------------
// Types — PostgREST row shape (snake_case from the database)
// ---------------------------------------------------------------------------

/** Raw ai_decisions row from PostgREST. */
interface AiDecisionRow {
  id: string;
  conversation_id: string;
  organization_id: string;
  message_id: string | null;
  decision_type: string;
  confidence: number;
  reasoning_summary: string | null;
  response_text: string | null;
  tags: string[];
  requires_human: boolean;
  raw_response: Record<string, unknown> | null;
  created_at: string;
}

const REGENERATED_DRAFT_POLL_INTERVAL_MS = 2_000;
const REGENERATED_DRAFT_POLL_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface AiDraftPanelProps {
  conversationId: string;
  aiState: AiState;
  /** Optional callback: when "Approve & send" is invoked, route the draft text
   *  to the right-panel/window to pre-fill the composer (per Phase 5 decision). */
  onPrefillComposer?: (text: string) => void;
}

export function AiDraftPanel({ conversationId, aiState, onPrefillComposer }: AiDraftPanelProps) {
  const queryClient = useQueryClient();
  const shouldLoadDecision = aiState === 'drafted' || aiState === 'needs_human';
  const {
    data: decisionData,
    isLoading: loading,
    error: decisionError,
    refetch: refetchDecision,
  } = useAiDecision(shouldLoadDecision ? conversationId : undefined);
  const [actionLoading, setActionLoading] = useState<'approve' | 'regenerate' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [supersededDecisionId, setSupersededDecisionId] = useState<string | null>(null);
  const [regenerationRecoveryError, setRegenerationRecoveryError] = useState<string | null>(null);
  const refetchDecisionRef = useRef(refetchDecision);

  const queriedDecision = (decisionData as AiDecisionRow | null | undefined) ?? null;
  const decision =
    queriedDecision?.id === supersededDecisionId ? null : queriedDecision;
  const error =
    actionError ??
    (decisionError instanceof Error
      ? decisionError.message
      : decisionError
        ? 'Failed to load AI decision'
        : null);

  useEffect(() => {
    setActionLoading(null);
    setActionError(null);
    setSupersededDecisionId(null);
    setRegenerationRecoveryError(null);
  }, [conversationId]);

  useEffect(() => {
    if (
      supersededDecisionId &&
      queriedDecision?.id &&
      queriedDecision.id !== supersededDecisionId
    ) {
      setSupersededDecisionId(null);
      setRegenerationRecoveryError(null);
    }
  }, [queriedDecision?.id, supersededDecisionId]);

  useEffect(() => {
    refetchDecisionRef.current = refetchDecision;
  }, [refetchDecision]);

  useEffect(() => {
    if (!supersededDecisionId || regenerationRecoveryError) return;

    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    const deadline = Date.now() + REGENERATED_DRAFT_POLL_TIMEOUT_MS;

    const stopWithError = (message: string) => {
      if (!cancelled) setRegenerationRecoveryError(message);
    };

    const poll = async () => {
      const result = await refetchDecisionRef.current();
      if (cancelled) return;

      if (result.error) {
        stopWithError(
          result.error instanceof Error
            ? `Could not refresh the regenerated draft: ${result.error.message}`
            : 'Could not refresh the regenerated draft.',
        );
        return;
      }

      const refreshedDecisionId = getDecisionId(result.data);
      if (
        refreshedDecisionId &&
        refreshedDecisionId !== supersededDecisionId
      ) {
        setSupersededDecisionId(null);
        setRegenerationRecoveryError(null);
        return;
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        stopWithError(
          'The regenerated draft is taking longer than expected. Refresh the conversation to check again.',
        );
        return;
      }

      pollTimer = setTimeout(
        () => void poll(),
        Math.min(REGENERATED_DRAFT_POLL_INTERVAL_MS, remainingMs),
      );
    };

    pollTimer = setTimeout(
      () => void poll(),
      REGENERATED_DRAFT_POLL_INTERVAL_MS,
    );

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [regenerationRecoveryError, supersededDecisionId]);

  // ---- Approve handler ---------------------------------------------------

  const handleApprove = useCallback(async () => {
    if (!decision) return;

    // Phase 5: pre-fill composer with draft text (per decision).
    if (onPrefillComposer && decision.response_text) {
      onPrefillComposer(decision.response_text);
      return;
    }

    setActionLoading('approve');
    setActionError(null);

    try {
      const token = getAccessToken();

      const res = await fetch(`/api/functions/approve-ai-draft`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          conversationId,
          aiDecisionId: decision.id,
        }),
      });

      if (!res.ok) {
        const body = await readResponseJsonObject(res, 'approve-ai-draft error');
        throw new Error(
          typeof body.error === 'string' ? body.error : 'Failed to approve draft',
        );
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to approve draft');
    } finally {
      setActionLoading(null);
    }
  }, [conversationId, decision, onPrefillComposer]);

  // ---- Regenerate handler ------------------------------------------------

  const handleRegenerate = useCallback(async () => {
    setActionLoading('regenerate');
    setActionError(null);

    try {
      const token = getAccessToken();

      const res = await fetch(`/api/functions/regenerate-ai-draft`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ conversationId }),
      });

      if (!res.ok) {
        const body = await readResponseJsonObject(res, 'regenerate-ai-draft error');
        throw new Error(
          typeof body.error === 'string' ? body.error : 'Failed to regenerate draft',
        );
      }

      const previousDecisionId = decision?.id ?? null;
      if (previousDecisionId) {
        setRegenerationRecoveryError(null);
        setSupersededDecisionId(previousDecisionId);
        queryClient.setQueryData(
          queryKeys.aiDecision(conversationId),
          (cachedDecision: unknown) =>
            getDecisionId(cachedDecision) === previousDecisionId
              ? null
              : cachedDecision,
        );
      }
      void invalidateConversationMutationCaches(queryClient, conversationId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to regenerate draft');
    } finally {
      setActionLoading(null);
    }
  }, [conversationId, decision?.id, queryClient]);

  // ---- Thinking state: show spinner with mono orange accent --------------

  if (aiState === 'thinking') {
    return (
      <div
        className="border-t border-[var(--m03-orange-line)] bg-[var(--m03-orange-fill)] px-6 py-3"
        role="status"
        aria-label="AI is processing"
      >
        <div className="flex items-center gap-2 text-[13px] text-[var(--m03-orange)]">
          <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          AI is analyzing the conversation…
        </div>
      </div>
    );
  }

  // ---- Needs human: show escalation reason -------------------------------

  if (aiState === 'needs_human') {
    return (
      <div
        className="border-t border-[var(--m03-red-line)] bg-[var(--m03-red-fill)] px-6 py-3"
        role="alert"
        aria-label="Escalation notice"
      >
        <div className="flex items-start gap-2">
          <svg className="mt-0.5 h-4 w-4 shrink-0 text-[var(--m03-red)]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-[var(--m03-red)]">
              Escalated — Human attention required
            </p>
            {loading ? (
              <p className="mt-1 font-mono text-[11px] text-[var(--m03-red)]">Loading escalation details…</p>
            ) : decision?.reasoning_summary ? (
              <p className="mt-1 text-[13px] text-[var(--m03-red)]">{decision.reasoning_summary}</p>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  // ---- Drafted: show draft with AI mono treatment ------------------------

  if (aiState === 'drafted') {
    if (loading || (supersededDecisionId && !decision)) {
      if (regenerationRecoveryError) {
        return (
          <div
            className="border-t border-[var(--m03-red-line)] bg-[var(--m03-red-fill)] px-6 py-3 text-[13px] text-[var(--m03-red)]"
            role="alert"
            aria-label="AI draft regeneration failed"
          >
            {regenerationRecoveryError}
          </div>
        );
      }

      return (
        <div
          className="border-t border-[var(--m03-orange-line)] bg-[var(--m03-orange-fill)] px-6 py-3"
          role="status"
          aria-label={supersededDecisionId ? 'Regenerating AI draft' : 'Loading AI draft'}
        >
          <div className="flex items-center gap-2 text-[13px] text-[var(--m03-orange)]">
            <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {supersededDecisionId ? 'Regenerating AI draft…' : 'Loading AI draft…'}
          </div>
        </div>
      );
    }

    if (!decision) return null;

    const confidencePercent = Math.round(decision.confidence * 100);

    return (
      <div
        className="border-t border-[var(--m03-orange-line)] bg-[var(--m03-orange-fill)] px-6 py-4"
        role="region"
        aria-label="AI draft response"
      >
        <div className="flex gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--m03-orange)] font-mono text-[11px] font-bold text-white">
            AI
          </div>

          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center gap-2">
              <span className="flex items-center gap-1 text-[13px] font-semibold text-[var(--m03-orange)]">
                AI Draft
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-[var(--m03-orange)]">
                  <path d="M6 1l1.5 3 3.5.5-2.5 2.5.5 3.5L6 9l-3 1.5.5-3.5L1 4.5 4.5 4 6 1z" fill="currentColor" />
                </svg>
              </span>
              <span className="ml-auto font-mono text-[10px] text-[var(--m03-fg-3)]">Just now</span>
            </div>

            {decision.response_text && (
              <div className="mb-3 rounded border border-[var(--m03-orange-line)] bg-white p-3">
                <p className="whitespace-pre-wrap text-[13px] leading-[1.55] text-[var(--m03-fg)]">
                  {decision.response_text}
                </p>
              </div>
            )}

            {error && (
              <p className="mb-2 font-mono text-[11px] text-[var(--m03-red)]" role="alert">{error}</p>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleApprove}
                disabled={actionLoading !== null}
                className="h-7 rounded-md border border-[var(--m03-fg)] bg-[var(--m03-fg)] px-3 text-[12px] font-semibold text-[var(--m03-bg)] transition-colors hover:bg-[var(--m03-fg-2)] disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Fill composer with AI draft"
              >
                {actionLoading === 'approve' ? 'Filling…' : 'Fill composer'}
              </button>

              <button
                type="button"
                onClick={handleRegenerate}
                disabled={actionLoading !== null}
                className="h-7 rounded-md border border-[var(--m03-line)] bg-white px-3 text-[12px] font-medium text-[var(--m03-fg)] transition-colors hover:bg-[var(--m03-line-2)] disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Regenerate AI draft"
              >
                {actionLoading === 'regenerate' ? 'Regenerating…' : 'Regenerate'}
              </button>

              <span className="ml-auto font-mono text-[10px] text-[var(--m03-fg-3)]">
                Confidence {confidencePercent}%
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function getDecisionId(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const id = (value as { id?: unknown }).id;
  return typeof id === 'string' ? id : null;
}
