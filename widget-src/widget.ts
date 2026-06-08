/**
 * InboxPilot Web Chat Widget — embeddable JS snippet.
 *
 * Usage:
 *   <script src="https://app.inboxpilot.com/widget.js"
 *           data-widget-id="wt_abc123"
 *           data-position="bottom-right"
 *           data-color="#2563eb"></script>
 *
 * Behavior:
 * 1. Reads data-widget-id from the script tag. No-ops if missing.
 * 2. Resumes existing session from localStorage if available.
 * 3. Otherwise calls webchat-thread-init to mint a fresh visitor token.
 * 4. Mounts an iframe pointing to the app's /wchat/[widgetId] page.
 * 5. Communication: parent ↔ iframe via postMessage.
 */

(function () {
  // Find our script tag
  const scripts = document.querySelectorAll('script[data-widget-id]');
  const scriptTag = scripts[scripts.length - 1] as HTMLScriptElement | undefined;

  if (!scriptTag) {
    console.warn('[InboxPilot] Widget script loaded without data-widget-id attribute.');
    return;
  }

  const widgetId = scriptTag.getAttribute('data-widget-id');
  if (!widgetId) {
    console.warn('[InboxPilot] data-widget-id is empty.');
    return;
  }

  const position = scriptTag.getAttribute('data-position') ?? 'bottom-right';
  const color = scriptTag.getAttribute('data-color') ?? '#2563eb';

  // Determine the app origin from the script src
  const scriptSrc = scriptTag.src;
  const appOrigin = new URL(scriptSrc).origin;

  // Storage key for visitor token
  const STORAGE_KEY = `inboxpilot:visitorToken:${widgetId}`;

  // State
  let visitorToken: string | null = localStorage.getItem(STORAGE_KEY);
  let iframeEl: HTMLIFrameElement | null = null;
  let isOpen = false;

  // ---------------------------------------------------------------------------
  // Token validation — check if stored token is expired before using it
  // ---------------------------------------------------------------------------

  function isTokenExpired(token: string): boolean {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return true;
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (!payload.exp) return false;
      // Expire 5 minutes early to avoid edge-case failures
      return payload.exp < (Date.now() / 1000) - 300;
    } catch {
      return true;
    }
  }

  // If stored token is expired, clear it so initSession creates a new one
  if (visitorToken && isTokenExpired(visitorToken)) {
    localStorage.removeItem(STORAGE_KEY);
    visitorToken = null;
  }

  // ---------------------------------------------------------------------------
  // Create the floating button
  // ---------------------------------------------------------------------------

  const btn = document.createElement('button');
  btn.id = 'inboxpilot-widget-btn';
  btn.setAttribute('aria-label', 'Open chat');
  btn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;

  Object.assign(btn.style, {
    position: 'fixed',
    bottom: '20px',
    [position === 'bottom-left' ? 'left' : 'right']: '20px',
    width: '56px',
    height: '56px',
    borderRadius: '50%',
    background: color,
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    zIndex: '2147483647',
    transition: 'transform 0.2s',
  });

  btn.addEventListener('mouseenter', () => { btn.style.transform = 'scale(1.05)'; });
  btn.addEventListener('mouseleave', () => { btn.style.transform = 'scale(1)'; });

  // ---------------------------------------------------------------------------
  // Create the iframe container
  // ---------------------------------------------------------------------------

  const container = document.createElement('div');
  container.id = 'inboxpilot-widget-container';
  Object.assign(container.style, {
    position: 'fixed',
    bottom: '90px',
    [position === 'bottom-left' ? 'left' : 'right']: '20px',
    width: '380px',
    height: '520px',
    maxHeight: 'calc(100vh - 120px)',
    borderRadius: '12px',
    overflow: 'hidden',
    boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
    zIndex: '2147483646',
    display: 'none',
    border: '1px solid #e5e7eb',
  });

  // ---------------------------------------------------------------------------
  // Initialize session & open widget
  // ---------------------------------------------------------------------------

  async function initSession(): Promise<{ token: string; preChatEnabled?: boolean } | null> {
    // If we have a token, validate it's still accepted by checking session-info
    if (visitorToken) {
      try {
        const checkRes = await fetch(`${appOrigin}/functions/v1/webchat-session-info`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${visitorToken}` },
          credentials: 'omit',
        });
        if (checkRes.ok) return { token: visitorToken, preChatEnabled: false };
        // Token rejected — clear and create new session
        localStorage.removeItem(STORAGE_KEY);
        visitorToken = null;
      } catch {
        // Network error — try using the token anyway
        if (visitorToken) return { token: visitorToken, preChatEnabled: false };
      }
    }

    try {
      const res = await fetch(`${appOrigin}/functions/v1/webchat-thread-init`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-widget-token': widgetId!,
        },
        credentials: 'omit',
        body: JSON.stringify({
          page_url: window.location.href,
          referrer: document.referrer || null,
          user_agent: navigator.userAgent,
        }),
      });

      if (!res.ok) return null;

      const json = await res.json();
      const token = json.data?.visitorToken;
      const preChatEnabled = json.data?.preChatEnabled ?? false;
      if (token) {
        visitorToken = token;
        localStorage.setItem(STORAGE_KEY, token);
        return { token, preChatEnabled };
      }
    } catch (err) {
      console.error('[InboxPilot] Failed to init session:', err);
    }
    return null;
  }

  function mountIframe(token: string, preChatEnabled = false) {
    if (iframeEl) return;

    iframeEl = document.createElement('iframe');
    const iframeUrl = new URL(`${appOrigin}/wchat/${widgetId}`);
    iframeUrl.searchParams.set('t', token);
    iframeUrl.searchParams.set('color', color);
    if (preChatEnabled) iframeUrl.searchParams.set('prechat', '1');

    iframeEl.src = iframeUrl.toString();
    iframeEl.style.width = '100%';
    iframeEl.style.height = '100%';
    iframeEl.style.border = 'none';
    iframeEl.setAttribute('title', 'Chat widget');
    iframeEl.setAttribute('allow', 'clipboard-write');

    container.appendChild(iframeEl);
  }

  async function toggleWidget() {
    if (isOpen) {
      container.style.display = 'none';
      isOpen = false;
      return;
    }

    const session = await initSession();
    if (!session) {
      console.error('[InboxPilot] Could not initialize chat session.');
      return;
    }

    mountIframe(session.token, session.preChatEnabled);
    container.style.display = 'block';
    isOpen = true;
  }

  btn.addEventListener('click', toggleWidget);

  // Listen for messages from iframe (e.g. close request, token rotation, auth failure)
  window.addEventListener('message', (event) => {
    if (event.origin !== appOrigin) return;
    if (event.data?.type === 'inboxpilot:close') {
      container.style.display = 'none';
      isOpen = false;
    }
    if (event.data?.type === 'inboxpilot:token_rotated' && event.data.token) {
      visitorToken = event.data.token;
      localStorage.setItem(STORAGE_KEY, event.data.token);
    }
    if (event.data?.type === 'inboxpilot:auth_expired') {
      // Token expired mid-session — tear down iframe and re-init on next open
      localStorage.removeItem(STORAGE_KEY);
      visitorToken = null;
      if (iframeEl) {
        container.removeChild(iframeEl);
        iframeEl = null;
      }
      container.style.display = 'none';
      isOpen = false;
    }
  });

  // ---------------------------------------------------------------------------
  // Mount elements
  // ---------------------------------------------------------------------------

  document.body.appendChild(btn);
  document.body.appendChild(container);
})();
