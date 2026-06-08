'use client';

import { useCallback, useState } from 'react';
import { getAccessToken } from '@/lib/insforge';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ReplyComposerProps {
  conversationId: string;
}

export function ReplyComposer({ conversationId }: ReplyComposerProps) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = body.trim();
      if (!trimmed) return;

      setSending(true);
      setError(null);
      try {
        const token = getAccessToken();

        const res = await fetch(`/api/functions/send-reply`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ conversationId, body: trimmed }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error((data as Record<string, string>).error ?? 'Failed to send reply');
        }

        setBody('');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to send reply');
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
      className="border-t border-surface-border bg-white"
      aria-label="Reply composer"
    >
      {/* Error */}
      {error && (
        <p className="px-4 pt-2 text-label-sm text-red-600" role="alert">{error}</p>
      )}

      {/* Textarea */}
      <div className="px-4 py-3">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your reply here..."
          rows={3}
          disabled={sending}
          className="w-full resize-none rounded border-0 p-0 text-body-md text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0 disabled:opacity-50"
          aria-label="Reply message"
        />
      </div>

      {/* Send button */}
      <div className="flex items-center justify-end px-4 pb-3">
        <button
          type="submit"
          disabled={!body.trim() || sending}
          className="inline-flex items-center gap-1.5 rounded bg-primary px-4 py-1.5 text-body-sm font-medium text-white transition-colors hover:bg-primary-600 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Send reply"
        >
          {sending ? (
            <svg className="h-3.5 w-3.5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <>
              Send
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M1 6h10M7 2l4 4-4 4" />
              </svg>
            </>
          )}
        </button>
      </div>
    </form>
  );
}
