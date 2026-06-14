'use client';

import { Suspense, useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';

/**
 * Widget iframe page — fully isolated (no app shell, no auth gate).
 * Renders chat messages and handles send via webchat-inbound function.
 * Subscribes to InsForge Realtime WebSocket for incoming agent/AI messages.
 * Implements pre-chat form when widget has pre_chat_enabled.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMessage {
  id: string;
  body: string;
  sender_type: 'contact' | 'user' | 'ai' | 'system';
  created_at: string;
}

// ---------------------------------------------------------------------------
// Realtime hook — subscribes to widget:{widgetId}:{jti} channel via WebSocket
// ---------------------------------------------------------------------------

function useRealtimeSubscription(
  wsBaseUrl: string,
  visitorToken: string,
  onMessage: (msg: ChatMessage) => void,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const connect = useCallback(() => {
    if (!wsBaseUrl || !visitorToken) return;

    // Extract jti from token for channel subscription
    let jti = '';
    let widgetId = '';
    try {
      const parts = visitorToken.split('.');
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      jti = payload.jti;
      widgetId = payload.widget;
    } catch {
      return;
    }

    if (!jti || !widgetId) return;

    const wsUrl = wsBaseUrl.replace(/^http/, 'ws') + '/realtime/v1/websocket';
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      // Subscribe to the visitor-specific channel
      ws.send(JSON.stringify({
        type: 'subscribe',
        channel: `widget:${widgetId}:${jti}`,
      }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.event === 'new_message' && data.payload) {
          const payload = data.payload;
          // The payload can be the message itself or contain a message property
          const msg: ChatMessage = payload.message ?? {
            id: payload.id ?? `rt_${Date.now()}`,
            body: payload.body,
            sender_type: payload.senderType ?? payload.sender_type ?? 'user',
            created_at: payload.created_at ?? new Date().toISOString(),
          };
          if (msg.body) {
            onMessage(msg);
          }
        }
      } catch { /* ignore malformed messages */ }
    };

    ws.onclose = () => {
      // Reconnect after 3s
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [wsBaseUrl, visitorToken, onMessage]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);
}

// ---------------------------------------------------------------------------
// Pre-chat form component
// ---------------------------------------------------------------------------

function PreChatForm({ color, onSubmit }: {
  color: string;
  onSubmit: (data: { name: string; email: string }) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    onSubmit({ name: name.trim(), email: email.trim() });
  };

  return (
    <form onSubmit={handleSubmit} className="wchat-prechat-form">
      <p className="wchat-prechat-title">Before we start, tell us about yourself:</p>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name"
        className="wchat-prechat-input"
        aria-label="Your name"
      />
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Your email *"
        required
        className="wchat-prechat-input"
        aria-label="Your email"
      />
      <button type="submit" className="wchat-prechat-btn" style={{ background: color }}>
        Start Chat
      </button>
    </form>
  );
}

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
  const params = useParams();
  const searchParams = useSearchParams();
  const widgetId = params.widgetId as string;
  const initialToken = searchParams.get('t') ?? '';

  const [visitorToken, setVisitorToken] = useState(initialToken);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [color, setColor] = useState('#2563eb');
  const [showPreChat, setShowPreChat] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageIdsRef = useRef(new Set<string>());

  const wsBaseUrl = process.env.NEXT_PUBLIC_INSFORGE_URL ?? '';

  // Deduplicated message handler for realtime
  const handleRealtimeMessage = useCallback((msg: ChatMessage) => {
    if (messageIdsRef.current.has(msg.id)) return;
    messageIdsRef.current.add(msg.id);
    setMessages((prev) => [...prev, msg]);
  }, []);

  // Subscribe to realtime WebSocket
  useRealtimeSubscription(wsBaseUrl, visitorToken, handleRealtimeMessage);

  // Fetch session info on mount
  useEffect(() => {
    if (!visitorToken) {
      setError('Unable to initialize chat session. Please close and reopen the chat.');
      return;
    }

    async function loadSession() {
      try {
        const res = await fetch(`/functions/v1/webchat-session-info`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${visitorToken}` },
          credentials: 'omit',
        });
        if (res.status === 401) {
          // Token expired — notify parent to re-init
          window.parent.postMessage({ type: 'inboxpilot:auth_expired' }, '*');
          return;
        }

        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          setError((json as { error?: string }).error ?? 'Unable to load this chat session.');
          return;
        }

        const json = await res.json();
        if (json.data?.history) {
          const history = json.data.history as ChatMessage[];
          history.forEach((m) => messageIdsRef.current.add(m.id));
          setMessages(history);
        }
        // Check if pre-chat is needed (no messages yet = fresh session, check widget config)
        if (json.data?.history?.length === 0 || !json.data?.history) {
          // We'll check pre-chat from URL param
          const preChatParam = searchParams.get('prechat');
          if (preChatParam === '1') {
            setShowPreChat(true);
          }
        }
        setSessionReady(true);
      } catch {
        setError('Network error while loading chat. Please try again.');
      }
    }

    loadSession();
  }, [visitorToken, wsBaseUrl, searchParams]);

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
      if (res.ok) {
        const json = await res.json();
        if (json.data?.visitorToken) {
          setVisitorToken(json.data.visitorToken);
          // Notify parent of token rotation
          window.parent.postMessage({
            type: 'inboxpilot:token_rotated',
            token: json.data.visitorToken,
          }, '*');
        }
      }
    } catch { /* identification is best-effort */ }
    setShowPreChat(false);
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    setSending(true);
    setError(null);

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
        window.parent.postMessage({ type: 'inboxpilot:auth_expired' }, '*');
        return;
      }

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: 'Send failed' }));
        setError(errBody.error ?? 'Send failed');
        messageIdsRef.current.delete(optimisticMsg.id);
        setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id));
      }
    } catch {
      setError('Network error');
      messageIdsRef.current.delete(optimisticMsg.id);
      setMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <style>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        .wchat-root { font-family: var(--font-inter), Inter, system-ui, -apple-system, sans-serif; height: 100vh; display: flex; flex-direction: column; background: var(--m03-bg); }
        .wchat-header { padding: 12px 16px; border-bottom: 1px solid var(--m03-line); display: flex; align-items: center; gap: 8px; }
        .wchat-header-dot { width: 8px; height: 8px; border-radius: 50%; }
        .wchat-header-title { font-size: 14px; font-weight: 600; color: var(--m03-fg); }
        .wchat-messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
        .wchat-msg { max-width: 80%; padding: 8px 12px; border-radius: 8px; font-size: 14px; line-height: 1.4; word-wrap: break-word; }
        .wchat-msg-contact { align-self: flex-end; background: var(--wchat-color); color: white; border-bottom-right-radius: 4px; }
        .wchat-msg-other { align-self: flex-start; background: var(--m03-line-2); color: var(--m03-fg-2); border-bottom-left-radius: 4px; }
        .wchat-msg-system { align-self: center; background: transparent; color: var(--m03-fg-3); font-size: 12px; font-style: italic; }
        .wchat-composer { padding: 12px 16px; border-top: 1px solid var(--m03-line); display: flex; gap: 8px; }
        .wchat-composer input { flex: 1; border: 1px solid var(--m03-line); border-radius: 6px; padding: 8px 12px; font-size: 14px; outline: none; }
        .wchat-composer input:focus { border-color: var(--wchat-color); box-shadow: 0 0 0 2px color-mix(in srgb, var(--wchat-color) 20%, transparent); }
        .wchat-composer button { background: var(--wchat-color); color: white; border: none; border-radius: 6px; width: 36px; height: 36px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
        .wchat-composer button:disabled { opacity: 0.5; cursor: not-allowed; }
        .wchat-error { padding: 8px 16px; background: var(--m03-bg); color: var(--m03-red); border-bottom: 1px solid var(--m03-red-line); font-size: 12px; text-align: center; }
        .wchat-prechat-form { display: flex; flex-direction: column; gap: 12px; padding: 24px 16px; flex: 1; justify-content: center; }
        .wchat-prechat-title { font-size: 14px; font-weight: 500; color: var(--m03-fg-2); text-align: center; margin-bottom: 4px; }
        .wchat-prechat-input { border: 1px solid var(--m03-line); border-radius: 6px; padding: 10px 14px; font-size: 14px; outline: none; }
        .wchat-prechat-input:focus { border-color: var(--wchat-color); box-shadow: 0 0 0 2px color-mix(in srgb, var(--wchat-color) 20%, transparent); }
        .wchat-prechat-btn { border: none; border-radius: 6px; padding: 10px 16px; font-size: 14px; font-weight: 500; color: white; cursor: pointer; }
        .wchat-prechat-btn:hover { opacity: 0.9; }
      `}</style>
      <div className="wchat-root" style={{ '--wchat-color': color } as React.CSSProperties}>
        <div className="wchat-header">
          <span className="wchat-header-dot" style={{ backgroundColor: color }} />
          <span className="wchat-header-title">Chat with us</span>
        </div>

        {showPreChat ? (
          <PreChatForm color={color} onSubmit={handlePreChatSubmit} />
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

            {error && <div className="wchat-error">{error}</div>}

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
