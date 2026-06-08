'use client';

import React from 'react';
import type { SenderType } from '@support-core/types';

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

const senderInitials: Record<SenderType, string> = {
  contact: '',
  user: 'AG',
  ai: 'AI',
  system: 'SY',
};

function formatMessageTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatChannelLabel(channel: string): string {
  if (channel === 'sms') return 'SMS';
  if (channel === 'webchat') return 'Web';
  return 'Email';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface MessageBubbleProps {
  message: MessageRow;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const { sender_type, body, created_at, channel } = message;

  // System messages — centered, subtle
  if (sender_type === 'system') {
    return (
      <div className="flex justify-center py-2">
        <div className="flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1">
          <p className="text-label-sm text-gray-500">{body}</p>
        </div>
      </div>
    );
  }

  const isContact = sender_type === 'contact';
  const isAi = sender_type === 'ai';

  return (
    <div className="flex gap-3">
      {/* Avatar */}
      <div className={`flex items-center justify-center w-8 h-8 rounded-full shrink-0 text-label-sm font-semibold ${
        isContact
          ? 'bg-gray-200 text-gray-600'
          : isAi
            ? 'bg-ai-50 text-ai'
            : 'bg-primary-50 text-primary'
      }`}>
        {isContact ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="7" cy="5" r="2.5" />
            <path d="M3 13c0-2.5 1.8-4 4-4s4 1.5 4 4" />
          </svg>
        ) : (
          senderInitials[sender_type]
        )}
      </div>

      {/* Message card */}
      <div className="flex-1 min-w-0">
        {/* Sender info + time */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-body-sm font-medium text-gray-900">
            {senderLabels[sender_type]}
          </span>
          <span className="text-label-sm text-gray-400">
            via {formatChannelLabel(channel)}
          </span>
          <span className="ml-auto text-label-sm text-gray-400">
            {formatMessageTime(created_at)}
          </span>
        </div>

        {/* Message body */}
        <div className={`rounded border p-3 ${
          isContact
            ? 'bg-white border-surface-border'
            : isAi
              ? 'bg-ai-50/50 border-ai-200'
              : 'bg-white border-surface-border'
        }`}>
          <p className="whitespace-pre-wrap text-body-md text-gray-800">{body}</p>
        </div>

        {/* AI confidence indicator */}
        {isAi && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-ai">
              <path d="M6 1l1.5 3 3.5.5-2.5 2.5.5 3.5L6 9l-3 1.5.5-3.5L1 4.5 4.5 4 6 1z" fill="currentColor" />
            </svg>
            <span className="text-label-sm text-ai font-medium">AI Generated</span>
          </div>
        )}
      </div>
    </div>
  );
}
