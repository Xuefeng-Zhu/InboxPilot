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
  channel: 'sms' | 'email';
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
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface MessageBubbleProps {
  message: MessageRow;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const { sender_type, body, created_at } = message;

  // System messages — centered, italic
  if (sender_type === 'system') {
    return (
      <div className="flex justify-center px-4 py-2">
        <div className="max-w-md text-center">
          <p className="text-xs italic text-gray-400">{body}</p>
          <time className="mt-0.5 block text-label-sm text-gray-500" dateTime={created_at}>
            {formatMessageTime(created_at)}
          </time>
        </div>
      </div>
    );
  }

  // Customer messages (contact): light gray background
  // Agent/AI replies (user, ai): white background
  const isContact = sender_type === 'contact';

  return (
    <div className="relative flex px-4 py-1.5">
      {/* Timeline dot */}
      <div className="absolute left-6 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full border-2 border-gray-200 bg-white" />

      <div className="ml-6 w-full max-w-[85%] pl-4">
        <div
          className={`rounded-lg border p-3 ${
            isContact
              ? 'bg-gray-50 border-gray-200'
              : 'bg-white border-surface-border'
          }`}
        >
          <p className="text-label-sm text-gray-500 font-medium">
            {senderLabels[sender_type]}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-body-md text-gray-900">{body}</p>
          <time
            className="mt-1.5 block text-right text-label-sm text-gray-500"
            dateTime={created_at}
          >
            {formatMessageTime(created_at)}
          </time>
        </div>
      </div>
    </div>
  );
}
