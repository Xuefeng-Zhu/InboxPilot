'use client';

import { Suspense, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { readResponseJsonObject } from '@/lib/http-json';
import { useRealtime } from '@/lib/use-realtime';
import { PreChatForm } from './PreChatForm';
import {
  getWidgetRealtimeChannel,
  normalizeRealtimeMessage,
  type ChatMessage,
} from './chat-utils';
import './wchat.css';

/**
 * Widget iframe page — fully isolated (no app shell, no auth gate).
 * Renders chat messages and handles send via webchat-inbound function.
 * Subscribes to InsForge Realtime (via @insforge/sdk) on
 * `widget:${widgetId}:${jti}` for incoming agent/AI messages.
 * Implements pre-chat form when widget has pre_chat_enabled.
 */

// ---------------------------------------------------------------------------
// Realtime subscription is handled by `useRealtime` from lib/use-realtime.ts
// (consumed in WidgetChatContent below). It uses the @insforge/sdk's
// Socket.IO-based Realtime client — NOT a raw WebSocket. A raw WebSocket
// would be rejected by the InsForge Realtime endpoint (which expects
// engine.io/Socket.IO framing), so the wchat page would never receive any
// agent/AI messages. The agent inbox uses the same hook on `org:${orgId}`.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function WidgetChatPage() {
  return (
    <Suspense
      fallback={
        <div style={{ display: 'flex', minHeight: '100vh', flexDirection: 'column', background: 'var(--m03-bg)', color: 'var(--m03-fg)' }}>
          <div
            style={{
              padding: '14px 16px',
              background: 'var(--wchat-color, var(--m03-fg))',
              color: 'var(--m03-bg)',
              fontFamily: 'var(--font-inter), Inter, system-ui, sans-serif',
              fontSize: 15,
              fontWeight: 600,
            }}
          >
            <span>Chat with us</span>
          </div>
          <div style={{ flex: 1, background: 'var(--m03-bg)' }} />
        </div>
      }
    >
      <WidgetChatContent />
    </Suspense>
  );
}

function WidgetChatContent() {
  const searchParams = useSearchParams();
  const initialToken = searchParams.get('t') ?? '';

  const [visitorToken, setVisitorToken] = useState(initialToken);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [color, setColor] = useState('#2563eb');
  const [showPreChat, setShowPreChat] = useState(false);
  const [identifying, setIdentifying] = useState(false);
  const [identifyError, setIdentifyError] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageIdsRef = useRef(new Set<string>());
  const identifyingRef = useRef(false);
  const preChatCompletedRef = useRef(false);

  // Deduplicated message handler for realtime
  const handleRealtimeMessage = useCallback((msg: ChatMessage) => {
    if (messageIdsRef.current.has(msg.id)) return;
    messageIdsRef.current.add(msg.id);
    setMessages((prev) => [...prev, msg]);
  }, []);

  // Per-visitor realtime channel. Both `widget` (the widget's INTERNAL UUID
  // — `webchat_widgets.id`, FK target of `webchat_threads.widget_id`) and
  // `jti` come from the visitor JWT. The `send-reply` route broadcasts to
  // `widget:${webchat_threads.widget_id}:${webchat_threads.visitor_token_jti}`,
  // which is the same internal UUID + jti, so the channel name matches.
  // IMPORTANT: do NOT use `params.widgetId` here — that is the PUBLIC
  // `widget_token` (e.g. `wt_abc123`), a different value from the internal
  // UUID, and would produce a channel that no broadcast ever targets.
  const realtimeChannel = useMemo(() => {
    return visitorToken ? getWidgetRealtimeChannel(visitorToken) : undefined;
  }, [visitorToken]);

  // The InsForge SDK Realtime payload shape has been observed as
  // `{ message, conversationId }` (the inner `realtimePublisher.publish`
  // argument). Be defensive: if `.message` is missing, fall back to treating
  // the payload itself as the message row.
  const onRealtime = useCallback(
    (payload: Record<string, unknown>) => {
      const timestamp = Date.now();
      const message = normalizeRealtimeMessage(
        payload,
        `rt_${timestamp}`,
        new Date(timestamp).toISOString(),
      );
      if (message) handleRealtimeMessage(message);
    },
    [handleRealtimeMessage],
  );

  // Subscribe via the InsForge SDK Realtime (Socket.IO) — same hook the
  // agent inbox uses on `org:${orgId}` channels.
  useRealtime({
    messageChannel: realtimeChannel,
    onNewMessage: onRealtime,
    enabled: !!realtimeChannel,
  });

  // Fetch session info on mount
  useEffect(() => {
    let cancelled = false;
    const abortController = new AbortController();

    if (!visitorToken) {
      setError('Unable to initialize chat session. Please close and reopen the chat.');
      return () => {
        cancelled = true;
        abortController.abort();
      };
    }

    async function loadSession() {
      try {
        const res = await fetch(`/functions/v1/webchat-session-info`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${visitorToken}` },
          credentials: 'omit',
          signal: abortController.signal,
        });
        if (cancelled) return;

        if (res.status === 401) {
          // Token expired — notify parent to re-init
          window.parent.postMessage({ type: 'inboxpilot:auth_expired' }, '*');
          return;
        }

        if (!res.ok) {
          const json = await readResponseJsonObject(res, 'webchat-session-info error');
          if (cancelled) return;
          setError(
            typeof json.error === 'string'
              ? json.error
              : 'Unable to load this chat session.',
          );
          return;
        }

        const json = await res.json();
        if (cancelled) return;
        if (json.data?.history) {
          const history = json.data.history as ChatMessage[];
          history.forEach((m) => messageIdsRef.current.add(m.id));
          setMessages(history);
        }
        // Identification is independent of message history: a greeting is a
        // message, but it must not bypass a widget's required pre-chat form.
        // `requiresPreChat` is authoritative on current deployments. The URL
        // fallback keeps rolling upgrades compatible with older functions.
        const requiresPreChat =
          typeof json.data?.requiresPreChat === 'boolean'
            ? json.data.requiresPreChat
            : searchParams.get('prechat') === '1' &&
              !json.data?.thread?.identifiedAt;
        setShowPreChat(
          requiresPreChat && !preChatCompletedRef.current,
        );
        setSessionReady(true);
      } catch (err) {
        if (
          cancelled ||
          (err instanceof DOMException && err.name === 'AbortError')
        ) return;
        setError('Network error while loading chat. Please try again.');
      }
    }

    void loadSession();
    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [visitorToken, searchParams]);

  // Read color from URL
  useEffect(() => {
    const urlColor = searchParams.get('color');
    if (urlColor) setColor(urlColor);
  }, [searchParams]);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Pre-chat submit — identify the visitor
  const handlePreChatSubmit = async (data: { name: string; email: string }) => {
    if (identifyingRef.current) return;

    identifyingRef.current = true;
    setIdentifying(true);
    setIdentifyError(null);

    try {
      const res = await fetch(`/functions/v1/webchat-identify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${visitorToken}`,
        },
        credentials: 'omit',
        body: JSON.stringify({ email: data.email, name: data.name }),
      });
      if (!res.ok) {
        const payload = await readResponseJsonObject(res, 'webchat-identify error');
        setIdentifyError(
          typeof payload.error === 'string'
            ? payload.error
            : 'Unable to identify this chat visitor.',
        );
        return;
      }

      const json = await res.json();
      if (typeof json.data?.visitorToken !== 'string') {
        setIdentifyError('Unable to refresh this chat session.');
        return;
      }
      preChatCompletedRef.current = true;
      setVisitorToken(json.data.visitorToken);
      window.parent.postMessage({
        type: 'inboxpilot:token_rotated',
        token: json.data.visitorToken,
      }, '*');
      setIdentifyError(null);
      setShowPreChat(false);
    } catch (err) {
      console.warn(
        'wchat: visitor identification failed',
        err instanceof Error ? err.message : String(err),
      );
      setIdentifyError('Network error while identifying this chat visitor.');
    } finally {
      identifyingRef.current = false;
      setIdentifying(false);
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    setSending(true);
    setSendError(null);

    // Optimistic update
    const optimisticMsg: ChatMessage = {
      id: `opt_${Date.now()}`,
      body: text,
      sender_type: 'contact',
      created_at: new Date().toISOString(),
    };
    messageIdsRef.current.add(optimisticMsg.id);
    setMessages((prev) => [...prev, optimisticMsg]);
    setInput('');

    const restoreFailedMessage = (message: string) => {
      messageIdsRef.current.delete(optimisticMsg.id);
      setMessages((prev) => prev.filter((item) => item.id !== optimisticMsg.id));
      setInput((current) => current || text);
      setSendError(message);
    };

    try {
      let pageUrl: string | undefined;
      try { pageUrl = window.parent?.location?.href; } catch { /* cross-origin */ }

      const res = await fetch(`/functions/v1/webchat-inbound`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${visitorToken}`,
        },
        credentials: 'omit',
        body: JSON.stringify({ text, page_url: pageUrl }),
      });

      if (res.status === 401) {
        restoreFailedMessage('Your chat session expired. Reconnecting…');
        window.parent.postMessage({ type: 'inboxpilot:auth_expired' }, '*');
        return;
      }

      if (!res.ok) {
        const errBody = await readResponseJsonObject(res, 'webchat-inbound error');
        restoreFailedMessage(
          typeof errBody.error === 'string' ? errBody.error : 'Send failed',
        );
      }
    } catch {
      restoreFailedMessage('Network error while sending. Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div className="wchat-root" style={{ '--wchat-color': color } as React.CSSProperties}>
        <div className="wchat-header">
          <span className="wchat-header-dot" style={{ backgroundColor: color }} />
          <span className="wchat-header-title">Chat with us</span>
        </div>

        {showPreChat ? (
          <PreChatForm
            color={color}
            error={identifyError}
            submitting={identifying}
            onSubmit={handlePreChatSubmit}
          />
        ) : (
          <>
            <div className="wchat-messages">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`wchat-msg ${
                    msg.sender_type === 'contact'
                      ? 'wchat-msg-contact'
                      : msg.sender_type === 'system'
                        ? 'wchat-msg-system'
                        : 'wchat-msg-other'
                  }`}
                >
                  {msg.body}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {error && <div className="wchat-error" role="alert">{error}</div>}

            {sendError && (
              <div className="wchat-error wchat-send-error" role="alert">
                <span>{sendError}</span>
                <button
                  type="button"
                  className="wchat-error-dismiss"
                  aria-label="Dismiss send error"
                  onClick={() => setSendError(null)}
                >
                  Dismiss
                </button>
              </div>
            )}

            <div className="wchat-composer">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
                placeholder="Type a message…"
                disabled={sending || !sessionReady || !!error}
                aria-label="Message input"
              />
              <button onClick={handleSend} disabled={sending || !input.trim() || !sessionReady || !!error} aria-label="Send message">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M14 2L7 9M14 2L9.5 14L7 9M14 2L2 6.5L7 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
