'use client';

import React from 'react';
import type { SenderType } from '@support-core/types';
import { cn } from '@/components/ui/cn';
import type { AiState } from '@/components/ui';

// ---------------------------------------------------------------------------
// Types — PostgREST row shape (snake_case from the database)
// ---------------------------------------------------------------------------

export interface MessageRow {
  id: string;
  conversation_id: string;
  sender_type: SenderType;
  sender_id: string | null;
  direction: 'inbound' | 'outbound';
  channel: 'sms' | 'email' | 'webchat';
  body: string;
  subject: string | null;
  raw_payload: Record<string, unknown>;
  provider: string | null;
  provider_account_id: string | null;
  external_message_id: string | null;
  delivery_status: string;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// AI-state visual treatment
//
// `sender_type === 'ai'` alone is not enough to pick a badge: an AI message can
// be a pending draft (orange "Drafted · awaiting approval"), an already-sent
// auto-reply (green "Auto-replied"), an escalation handoff (red "Needs human"),
// or a failure. The conversation's `ai_state` carries that signal, so the bubble
// branches on it. Missing/unknown state falls back to the draft treatment to
// preserve the legacy rendering for any consumer that hasn't threaded the
// state through yet.
// ---------------------------------------------------------------------------

interface AiStateStyle {
  /** Pill label, e.g. "Drafted" / "Auto-replied". */
  badgeLabel: string;
  /** Tailwind class set for the pill (border, fill, text). */
  badgeClassName: string;
  /** Tailwind class set for the bubble border. */
  borderClassName: string;
  /** Tailwind class set for the sender-name color. */
  senderClassName: string;
  /** Suffix text appended to the meta line; the template adds the " · " separator. */
  metaSuffix: string;
}

const aiStateStyles: Record<AiState, AiStateStyle | null> = {
  idle: null,
  thinking: {
    badgeLabel: 'Thinking',
    badgeClassName:
      'border-[var(--m03-orange-line)] bg-[var(--m03-orange-fill)] text-[var(--m03-orange)]',
    borderClassName: 'border-[var(--m03-orange-line)]',
    senderClassName: 'text-[var(--m03-orange)]',
    metaSuffix: 'generating',
  },
  drafted: {
    badgeLabel: 'Drafted',
    badgeClassName:
      'border-[var(--m03-orange-line)] bg-[var(--m03-orange-fill)] text-[var(--m03-orange)]',
    borderClassName: 'border-[var(--m03-orange)]',
    senderClassName: 'text-[var(--m03-orange)]',
    metaSuffix: 'awaiting approval',
  },
  auto_replied: {
    badgeLabel: 'Auto-replied',
    badgeClassName:
      'border-[var(--m03-green-line)] bg-[var(--m03-green-fill)] text-[var(--m03-green)]',
    borderClassName: 'border-[var(--m03-green)]',
    senderClassName: 'text-[var(--m03-green)]',
    metaSuffix: 'auto-replied',
  },
  needs_human: {
    badgeLabel: 'Needs human',
    badgeClassName:
      'border-[var(--m03-red-line)] bg-[var(--m03-red-fill)] text-[var(--m03-red)]',
    borderClassName: 'border-[var(--m03-red)]',
    senderClassName: 'text-[var(--m03-red)]',
    metaSuffix: 'awaiting agent',
  },
  failed: {
    badgeLabel: 'Failed',
    badgeClassName:
      'border-[var(--m03-red-line)] bg-[var(--m03-red-fill)] text-[var(--m03-red)]',
    borderClassName: 'border-[var(--m03-red)]',
    senderClassName: 'text-[var(--m03-red)]',
    metaSuffix: 'failed',
  },
};

const DRAFTED_FALLBACK_STYLE = aiStateStyles.drafted as AiStateStyle;

function getAiStyle(aiState: AiState | null | undefined): AiStateStyle | null {
  if (!aiState) return DRAFTED_FALLBACK_STYLE;
  return aiStateStyles[aiState] ?? DRAFTED_FALLBACK_STYLE;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const senderLabels: Record<SenderType, string> = {
  contact: 'Customer',
  user: 'Agent',
  ai: 'AI',
  system: 'System',
};

function formatMessageTime(dateStr: string): string {
  const date = new Date(dateStr);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}Z`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface MessageBubbleProps {
  message: MessageRow;
  contactName?: string | null;
  /**
   * Conversation-level AI state. Determines the badge + meta-suffix rendered on
   * `sender_type === 'ai'` messages. When omitted, falls back to the draft
   * treatment so legacy callers behave unchanged.
   */
  aiState?: AiState | null;
}

export function MessageBubble({ message, contactName, aiState }: MessageBubbleProps) {
  const { sender_type, body, created_at, direction } = message;

  // System messages — centered, subtle
  if (sender_type === 'system') {
    return (
      <div className="flex justify-center py-1">
        <div className="rounded-full bg-[var(--m03-line-2)] px-3 py-1">
          <p className="font-mono text-[10px] text-[var(--m03-fg-3)]">{body}</p>
        </div>
      </div>
    );
  }

  const isContact = sender_type === 'contact';
  const isAi = sender_type === 'ai';
  // Visual alignment depends on the author:
  //   contact (customer) → always left-aligned (inbound)
  //   user (agent)       → right-aligned (outbound)
  //   ai                 → left-aligned (draft or sent reply, both stay on the
  //                        customer side of the thread)
  const isOutbound = !isContact && !isAi;

  // AI messages pick their pill/border/color from the conversation's ai_state.
  const aiStyle = isAi ? getAiStyle(aiState) : null;

  // Sender display: 'ContactName · Customer' for contact, else role label.
  const senderName =
    sender_type === 'contact'
      ? `${contactName ?? 'Customer'} · Customer`
      : senderLabels[sender_type];

  return (
    <div
      className={cn(
        'flex w-full',
        isOutbound && !isAi ? 'justify-end' : 'justify-start',
      )}
    >
      <div className={cn('flex max-w-[72%] flex-col gap-1')}>
        {/* Sender block */}
        <div
          className={cn(
            'flex items-baseline gap-2',
            isOutbound && !isAi ? 'flex-row-reverse' : 'flex-row',
          )}
        >
          <span
            className={cn(
              'text-[11px] font-semibold uppercase tracking-[0.04em]',
              isAi && aiStyle ? aiStyle.senderClassName : 'text-[var(--m03-fg)]',
            )}
          >
            {senderName}
          </span>
          {isAi && aiStyle && (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-px font-mono text-[10px] font-semibold uppercase tracking-[0.04em]',
                aiStyle.badgeClassName,
              )}
            >
              <span
                className="h-1.5 w-1.5 rounded-full bg-current"
                aria-hidden="true"
              />
              {aiStyle.badgeLabel}
            </span>
          )}
        </div>

        {/* Bubble */}
        <div
          className={cn(
            'rounded-lg px-3.5 py-2.5 text-[13px] leading-[1.55]',
            isContact && 'bg-[var(--m03-line-2)] text-[var(--m03-fg)]',
            isAi && aiStyle && cn('border bg-white text-[var(--m03-fg)]', aiStyle.borderClassName),
            isOutbound && !isAi && !isContact && 'bg-[var(--m03-fg)] text-[var(--m03-bg)]',
          )}
        >
          {body}
        </div>

        {/* Meta */}
        <div
          className={cn(
            'mt-1 font-mono text-[10px] uppercase tracking-[0.04em] text-[var(--m03-fg-3)]',
            isOutbound && !isAi ? 'text-right' : 'text-left',
          )}
        >
          {formatMessageTime(created_at)}
          {isAi && aiStyle && ` · ${aiStyle.metaSuffix}`}
        </div>
      </div>
    </div>
  );
}
