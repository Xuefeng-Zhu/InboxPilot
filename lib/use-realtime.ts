'use client';

import { useEffect, useRef } from 'react';
import { insforge } from '@/lib/insforge';

/**
 * useRealtime — Subscribes to InsForge Realtime channels via WebSocket.
 *
 * Replaces the old polling approach with live push notifications.
 * Triggers callbacks when messages or conversations change.
 *
 * Requirements: 18.7, 19.4, 26.4
 */

interface UseRealtimeOptions {
  /** Called when a new message arrives for a specific conversation. */
  onNewMessage?: (payload: Record<string, unknown>) => void;
  /** Called when any conversation in the org is updated. */
  onConversationUpdated?: (payload: Record<string, unknown>) => void;
  /** Called when a knowledge document is updated. */
  onKnowledgeDocumentUpdated?: (payload: Record<string, unknown>) => void;
  /** Channel to subscribe for messages (e.g., `inbox:messages:<conversationId>`). */
  messageChannel?: string;
  /** Channel to subscribe for conversation updates (e.g., `inbox:conversations:<orgId>`). */
  conversationChannel?: string;
  /** Set to false to disable subscriptions. Defaults to true. */
  enabled?: boolean;
}

export function useRealtime(options: UseRealtimeOptions): void {
  const {
    onNewMessage,
    onConversationUpdated,
    onKnowledgeDocumentUpdated,
    messageChannel,
    conversationChannel,
    enabled = true,
  } = options;

  // Store callbacks in refs so subscriptions don't need to be reset
  // when callback identity changes.
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;
    const channels: string[] = [];

    async function setup() {
      try {
        await insforge.realtime.connect();
      } catch {
        // Already connected — that's fine
      }

      if (disposed) return;

      // Subscribe to per-conversation message channel
      if (messageChannel) {
        const res = await insforge.realtime.subscribe(messageChannel);
        if (res.ok) {
          channels.push(messageChannel);
        }
      }

      // Subscribe to org-level conversation updates channel
      if (conversationChannel) {
        const res = await insforge.realtime.subscribe(conversationChannel);
        if (res.ok) {
          channels.push(conversationChannel);
        }
      }
    }

    // Event handlers that delegate to the latest callbacks
    function handleMessageCreated(payload: Record<string, unknown>) {
      callbacksRef.current.onNewMessage?.(payload);
    }

    function handleConversationUpdated(payload: Record<string, unknown>) {
      callbacksRef.current.onConversationUpdated?.(payload);
    }

    insforge.realtime.on('message_created', handleMessageCreated);
    insforge.realtime.on('conversation_updated', handleConversationUpdated);

    setup();

    return () => {
      disposed = true;
      insforge.realtime.off('message_created', handleMessageCreated);
      insforge.realtime.off('conversation_updated', handleConversationUpdated);

      // Unsubscribe from channels
      for (const ch of channels) {
        insforge.realtime.unsubscribe(ch);
      }
    };
  }, [enabled, messageChannel, conversationChannel]);
}
