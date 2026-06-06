'use client';

import { useCallback, useState } from 'react';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ReplyComposerProps {
  conversationId: string;
}

export function ReplyComposer({ conversationId }: ReplyComposerProps) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = body.trim();
      if (!trimmed) return;

      setSending(true);
      try {
        // TODO: Call the send-reply function entrypoint once implemented (Task 11).
        // For now, log to console.
        console.log('[ReplyComposer] send-reply', { conversationId, body: trimmed });
        setBody('');
      } finally {
        setSending(false);
      }
    },
    [body, conversationId],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Submit on Enter (without Shift)
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit(e as unknown as React.FormEvent);
      }
    },
    [handleSubmit],
  );

  return (
    <form
      onSubmit={handleSubmit}
      className="border-t border-gray-200 bg-white px-4 py-3"
      aria-label="Reply composer"
    >
      <div className="flex items-end gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a reply..."
          rows={2}
          disabled={sending}
          className="flex-1 resize-none rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
          aria-label="Reply message"
        />
        <button
          type="submit"
          disabled={!body.trim() || sending}
          className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Send reply"
        >
          {sending ? (
            <svg
              className="h-4 w-4 animate-spin"
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
          ) : (
            'Send'
          )}
        </button>
      </div>
    </form>
  );
}
