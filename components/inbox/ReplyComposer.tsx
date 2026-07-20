'use client';

import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { readResponseJsonObject } from '@/lib/http-json';
import { getAccessToken } from '@/lib/insforge';
import { invalidateConversationMutationCaches } from '@/lib/queries';

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
  const [acceptedWarning, setAcceptedWarning] = useState<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    setBody('');
    setAcceptedWarning(null);
  }, [conversationId]);

  // Adopt external prefill (e.g. "Fill composer" from the AI Draft panel)
  useEffect(() => {
    if (typeof prefillBody === 'string' && prefillBody.trim().length > 0) {
      setBody(prefillBody);
      onPrefillConsumed?.();
    }
  }, [prefillBody, onPrefillConsumed]);

  const mutation = useMutation({
    mutationFn: async (trimmedBody: string) => {
      const token = getAccessToken();
      const res = await fetch('/api/functions/send-reply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ conversationId, body: trimmedBody }),
      });
      const data = await readResponseJsonObject(res, 'send-reply response');
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to send reply');
      }
      return data;
    },
    onMutate: () => {
      setAcceptedWarning(null);
    },
    onSuccess: (result) => {
      setBody('');
      setAcceptedWarning(
        typeof result.warning === 'string' && result.warning.trim()
          ? result.warning
          : null,
      );
      // SMS/email publish no org realtime event, so refresh every direct and
      // derived conversation view explicitly after the server mutation.
      void invalidateConversationMutationCaches(queryClient, conversationId);
    },
  });

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = body.trim();
      if (!trimmed || mutation.isPending) return;
      mutation.mutate(trimmed);
    },
    [body, mutation],
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

  const sending = mutation.isPending;
  const error = mutation.error
    ? mutation.error instanceof Error
      ? mutation.error.message
      : 'Failed to send reply'
    : null;

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

      {acceptedWarning && (
        <div
          className="mx-6 mt-3 flex items-start gap-3 rounded-md border border-[var(--m03-orange-line)] bg-[var(--m03-orange-fill)] px-3 py-2 text-[12px] text-[var(--m03-orange)]"
          role="alert"
        >
          <span className="flex-1">{acceptedWarning}</span>
          <button
            type="button"
            onClick={() => setAcceptedWarning(null)}
            className="shrink-0 font-medium text-[var(--m03-orange)] underline-offset-2 hover:underline"
            aria-label="Dismiss reply warning"
          >
            Dismiss
          </button>
        </div>
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
