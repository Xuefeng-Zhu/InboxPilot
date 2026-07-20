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

type SharedChannelStatus = 'pending' | 'subscribed' | 'failed';

interface SharedChannelState {
  references: number;
  status: SharedChannelStatus;
  subscription: Promise<boolean>;
}

interface SharedChannelLease {
  channel: string;
  state: SharedChannelState;
}

const sharedChannels = new Map<string, SharedChannelState>();

function acquireChannel(channel: string): SharedChannelLease {
  let state = sharedChannels.get(channel);

  if (!state) {
    state = {
      references: 0,
      status: 'pending',
      subscription: Promise.resolve(false),
    };
    const newState = state;
    sharedChannels.set(channel, newState);

    newState.subscription = Promise.resolve()
      .then(() => insforge.realtime.subscribe(channel))
      .then((response) => {
        if (!response.ok) {
          newState.status = 'failed';
          if (sharedChannels.get(channel) === newState) {
            sharedChannels.delete(channel);
          }
          return false;
        }

        newState.status = 'subscribed';
        if (newState.references === 0) {
          insforge.realtime.unsubscribe(channel);
          if (sharedChannels.get(channel) === newState) {
            sharedChannels.delete(channel);
          }
        }
        return true;
      })
      .catch((error: unknown) => {
        newState.status = 'failed';
        if (sharedChannels.get(channel) === newState) {
          sharedChannels.delete(channel);
        }
        throw error;
      });
  }

  state.references += 1;
  return { channel, state };
}

function releaseChannel({ channel, state }: SharedChannelLease): void {
  state.references = Math.max(0, state.references - 1);
  if (state.references > 0) return;

  if (state.status === 'subscribed') {
    insforge.realtime.unsubscribe(channel);
  }
  if (state.status !== 'pending' && sharedChannels.get(channel) === state) {
    sharedChannels.delete(channel);
  }
}

export function useRealtime(options: UseRealtimeOptions): void {
  const {
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
    const channelLeases: SharedChannelLease[] = [];

    async function setup() {
      try {
        await insforge.realtime.connect();
      } catch {
        // Already connected is benign; subscription failures below are reported.
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
        if (disposed) return;
        const lease = acquireChannel(channel);
        channelLeases.push(lease);
        try {
          const subscribed = await lease.state.subscription;
          if (disposed) return;
          if (!subscribed) {
            console.warn(`useRealtime: failed to subscribe to ${channel}`);
          }
        } catch (err) {
          if (!disposed) {
            console.warn(
              `useRealtime: subscribe threw for ${channel}`,
              err instanceof Error ? err.message : String(err),
            );
          }
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

    void setup();

    return () => {
      disposed = true;
      insforge.realtime.off('new_message', handleMessageCreated);
      insforge.realtime.off('message_created', handleMessageCreated);
      insforge.realtime.off('conversation_updated', handleConversationUpdated);
      insforge.realtime.off('knowledge_document_updated', handleKnowledgeDocumentUpdated);

      // Release shared channels. The SDK subscription is removed only after
      // the final hook consumer releases its lease.
      for (const lease of channelLeases) {
        releaseChannel(lease);
      }
    };
  }, [enabled, messageChannel, conversationChannel]);
}
