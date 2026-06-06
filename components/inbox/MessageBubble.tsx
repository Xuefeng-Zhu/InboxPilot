'use client';

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
          <time className="mt-0.5 block text-[10px] text-gray-300" dateTime={created_at}>
            {formatMessageTime(created_at)}
          </time>
        </div>
      </div>
    );
  }

  // Inbound (contact) — left-aligned, gray
  const isInbound = sender_type === 'contact';

  return (
    <div
      className={`flex px-4 py-1.5 ${isInbound ? 'justify-start' : 'justify-end'}`}
    >
      <div
        className={`max-w-[70%] rounded-lg px-3 py-2 ${
          isInbound
            ? 'bg-gray-100 text-gray-900'
            : 'bg-blue-600 text-white'
        }`}
      >
        <p
          className={`text-[11px] font-medium ${
            isInbound ? 'text-gray-500' : 'text-blue-100'
          }`}
        >
          {senderLabels[sender_type]}
        </p>
        <p className="mt-0.5 whitespace-pre-wrap text-sm">{body}</p>
        <time
          className={`mt-1 block text-right text-[10px] ${
            isInbound ? 'text-gray-400' : 'text-blue-200'
          }`}
          dateTime={created_at}
        >
          {formatMessageTime(created_at)}
        </time>
      </div>
    </div>
  );
}
