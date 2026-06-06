'use client';

import { useEffect, useRef } from 'react';

/**
 * useRealtime — Periodically refetches data to simulate realtime updates.
 *
 * This is a pragmatic MVP approach: instead of a full WebSocket/Socket.IO
 * integration, we poll at a configurable interval (default 5 seconds).
 * Real WebSocket integration via InsForge Realtime would replace this later.
 *
 * Usage:
 *   useRealtime({
 *     onNewMessage: () => refetchMessages(),
 *     onConversationUpdated: () => refetchConversations(),
 *     onKnowledgeDocumentUpdated: () => refetchDocuments(),
 *     intervalMs: 5000,
 *   });
 *
 * Requirements: 18.7, 19.4, 26.4
 */

interface UseRealtimeOptions {
  /** Called on each poll interval to refetch messages. */
  onNewMessage?: () => void;
  /** Called on each poll interval to refetch conversations. */
  onConversationUpdated?: () => void;
  /** Called on each poll interval to refetch knowledge documents. */
  onKnowledgeDocumentUpdated?: () => void;
  /** Polling interval in milliseconds. Defaults to 5000 (5 seconds). */
  intervalMs?: number;
  /** Set to false to disable polling. Defaults to true. */
  enabled?: boolean;
}

export function useRealtime(options: UseRealtimeOptions): void {
  const {
    onNewMessage,
    onConversationUpdated,
    onKnowledgeDocumentUpdated,
    intervalMs = 5000,
    enabled = true,
  } = options;

  // Store callbacks in refs so the interval doesn't need to be reset
  // when callbacks change identity.
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  useEffect(() => {
    if (!enabled) return;

    const id = setInterval(() => {
      const cbs = callbacksRef.current;
      cbs.onNewMessage?.();
      cbs.onConversationUpdated?.();
      cbs.onKnowledgeDocumentUpdated?.();
    }, intervalMs);

    return () => clearInterval(id);
  }, [enabled, intervalMs]);
}
