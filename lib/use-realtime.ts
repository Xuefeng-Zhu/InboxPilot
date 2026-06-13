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
  /** Channel to subscribe for messages (e.g., `org:<organizationId>`). */
  messageChannel?: string;
  /** Channel to subscribe for conversation updates (e.g., `org:<organizationId>`). */
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

      const requestedChannels = Array.from(
        new Set(
          [messageChannel, conversationChannel].filter(
            (channel): channel is string => typeof channel === 'string' && channel.length > 0,
          ),
        ),
      );

      for (const channel of requestedChannels) {
        const res = await insforge.realtime.subscribe(channel);
        if (res.ok) {
          channels.push(channel);
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

    function handleKnowledgeDocumentUpdated(payload: Record<string, unknown>) {
      callbacksRef.current.onKnowledgeDocumentUpdated?.(payload);
    }

    insforge.realtime.on('new_message', handleMessageCreated);
    insforge.realtime.on('message_created', handleMessageCreated);
    insforge.realtime.on('conversation_updated', handleConversationUpdated);
    insforge.realtime.on('knowledge_document_updated', handleKnowledgeDocumentUpdated);

    setup();

    return () => {
      disposed = true;
      insforge.realtime.off('new_message', handleMessageCreated);
      insforge.realtime.off('message_created', handleMessageCreated);
      insforge.realtime.off('conversation_updated', handleConversationUpdated);
      insforge.realtime.off('knowledge_document_updated', handleKnowledgeDocumentUpdated);

      // Unsubscribe from channels
      for (const ch of channels) {
        insforge.realtime.unsubscribe(ch);
      }
    };
  }, [enabled, messageChannel, conversationChannel]);
}
