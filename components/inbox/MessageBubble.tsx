'use client';

import React from 'react';
import type { SenderType } from '@support-core/types';
import { cn } from '@/components/ui/cn';

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
}

export function MessageBubble({ message, contactName }: MessageBubbleProps) {
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
  //   ai                 → left-aligned (proposed draft)
  const isOutbound = !isContact && !isAi;

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
              isAi ? 'text-[var(--m03-orange)]' : 'text-[var(--m03-fg)]',
            )}
          >
            {senderName}
          </span>
          {isAi && (
            <span className="inline-flex items-center gap-1 rounded-[3px] border border-[var(--m03-orange-line)] bg-[var(--m03-orange-fill)] px-1.5 py-px font-mono text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--m03-orange)]">
              <span
                className="h-1.5 w-1.5 rounded-full bg-[var(--m03-orange)]"
                aria-hidden="true"
              />
              Drafted
            </span>
          )}
        </div>

        {/* Bubble */}
        <div
          className={cn(
            'rounded-lg px-3.5 py-2.5 text-[13px] leading-[1.55]',
            isContact && 'bg-[var(--m03-line-2)] text-[var(--m03-fg)]',
            isAi && 'border border-[var(--m03-orange)] bg-white text-[var(--m03-fg)]',
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
          {isAi && ' · awaiting approval'}
        </div>
      </div>
    </div>
  );
}
