'use client';

import { useCallback, useEffect, useState } from 'react';
import { getAccessToken } from '@/lib/insforge';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ReplyComposerProps {
  conversationId: string;
  /** External pre-fill source. When the value changes, the composer adopts it. */
  prefillBody?: string | null;
  /** Notifies the parent that the prefill has been consumed. */
  onPrefillConsumed?: () => void;
}

export function ReplyComposer({
  conversationId,
  prefillBody,
  onPrefillConsumed,
}: ReplyComposerProps) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Adopt external prefill (e.g. "Approve & send" from the right panel)
  useEffect(() => {
    if (typeof prefillBody === 'string' && prefillBody.trim().length > 0) {
      setBody(prefillBody);
      onPrefillConsumed?.();
    }
  }, [prefillBody, onPrefillConsumed]);

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
      className="border-t border-[var(--m03-line)] bg-white"
      aria-label="Reply composer"
    >
      {/* Error */}
      {error && (
        <p className="px-6 pt-2 font-mono text-[10px] text-[var(--m03-red)]" role="alert">
          {error}
        </p>
      )}

      {/* Textarea */}
      <div className="px-6 py-3.5">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Reply to customer, or edit the AI draft…"
          rows={2}
          disabled={sending}
          className="block w-full resize-none rounded-md border border-[var(--m03-line)] bg-white px-3 py-2.5 text-[13px] leading-[1.55] text-[var(--m03-fg)] placeholder:text-[var(--m03-fg-3)] focus:border-[var(--m03-fg)] focus:outline-none disabled:opacity-50"
          aria-label="Reply message"
        />
      </div>

      {/* Action row */}
      <div className="flex flex-wrap items-center gap-2 px-6 pb-4">
        <span className="ml-auto whitespace-nowrap font-mono text-[10px] text-[var(--m03-fg-3)]">
          <kbd className="rounded-[3px] border border-[var(--m03-line)] bg-[var(--m03-line-2)] px-1.5 py-px font-sans text-[10px]">
            Enter
          </kbd>{' '}
          to send ·{' '}
          <kbd className="rounded-[3px] border border-[var(--m03-line)] bg-[var(--m03-line-2)] px-1.5 py-px font-sans text-[10px]">
            Shift+Enter
          </kbd>{' '}
          newline
        </span>

        <button
          type="submit"
          disabled={!body.trim() || sending}
          className="h-7 shrink-0 whitespace-nowrap rounded-md border border-[var(--m03-fg)] bg-[var(--m03-fg)] px-3 text-[12px] font-semibold text-[var(--m03-bg)] transition-colors hover:bg-[var(--m03-fg-2)] disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Send reply"
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </form>
  );
}
