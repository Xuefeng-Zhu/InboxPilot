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

interface InboxPilotWidgetApi {
  destroy: () => void;
}

interface InboxPilotWidgetWindow extends Window {
  InboxPilotWidget?: InboxPilotWidgetApi;
}

(function () {
  const widgetWindow = window as InboxPilotWidgetWindow;

  // Loading the bundle twice replaces the previous instance instead of
  // leaving duplicate launchers and global message listeners behind.
  widgetWindow.InboxPilotWidget?.destroy();
  document.getElementById('inboxpilot-widget-btn')?.remove();
  document.getElementById('inboxpilot-widget-container')?.remove();

  // Find our script tag
  const scripts = document.querySelectorAll('script[data-widget-id]');
  const scriptTag = scripts[scripts.length - 1] as HTMLScriptElement | undefined;

  if (!scriptTag) {
    console.warn('[InboxPilot] Widget script loaded without data-widget-id attribute.');
    return;
  }

  const widgetIdAttribute = scriptTag.getAttribute('data-widget-id');
  if (!widgetIdAttribute) {
    console.warn('[InboxPilot] data-widget-id is empty.');
    return;
  }
  const widgetId: string = widgetIdAttribute;

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
  let destroyed = false;
  let togglePending = false;
  const requestAbortController = new AbortController();

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

  const CHAT_ICON_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;
  const CLOSE_ICON_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

  const btn = document.createElement('button');
  btn.id = 'inboxpilot-widget-btn';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Open chat');
  btn.innerHTML = CHAT_ICON_SVG;

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

  function handleLauncherMouseEnter() {
    btn.style.transform = 'scale(1.05)';
  }

  function handleLauncherMouseLeave() {
    btn.style.transform = 'scale(1)';
  }

  btn.addEventListener('mouseenter', handleLauncherMouseEnter);
  btn.addEventListener('mouseleave', handleLauncherMouseLeave);

  function updateLauncherIcon() {
    btn.innerHTML = isOpen ? CLOSE_ICON_SVG : CHAT_ICON_SVG;
    btn.setAttribute('aria-label', isOpen ? 'Close chat' : 'Open chat');
  }

  // ---------------------------------------------------------------------------
  // Create the iframe container
  // ---------------------------------------------------------------------------

  const container = document.createElement('div');
  container.id = 'inboxpilot-widget-container';
  Object.assign(container.style, {
    position: 'fixed',
    bottom: '90px',
    [position === 'bottom-left' ? 'left' : 'right']: '12px',
    width: '380px',
    height: '520px',
    maxWidth: 'calc(100vw - 24px)',
    maxHeight: 'calc(100vh - 112px)',
    boxSizing: 'border-box',
    borderRadius: '12px',
    overflow: 'hidden',
    boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
    zIndex: '2147483646',
    display: 'none',
    border: '1px solid #e5e7eb',
  });

  // Header close button (overlay on the chat panel)
  const panelCloseBtn = document.createElement('button');
  panelCloseBtn.id = 'inboxpilot-widget-panel-close';
  panelCloseBtn.type = 'button';
  panelCloseBtn.setAttribute('aria-label', 'Close chat');
  panelCloseBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#374151" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
  Object.assign(panelCloseBtn.style, {
    position: 'absolute',
    top: '8px',
    right: '8px',
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    background: 'rgba(255, 255, 255, 0.95)',
    border: '1px solid rgba(0, 0, 0, 0.08)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0',
    zIndex: '1',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  });
  function handlePanelCloseMouseEnter() {
    panelCloseBtn.style.background = 'rgba(243, 244, 246, 1)';
  }

  function handlePanelCloseMouseLeave() {
    panelCloseBtn.style.background = 'rgba(255, 255, 255, 0.95)';
  }

  function closeWidget() {
    container.style.display = 'none';
    isOpen = false;
    updateLauncherIcon();
  }

  panelCloseBtn.addEventListener('mouseenter', handlePanelCloseMouseEnter);
  panelCloseBtn.addEventListener('mouseleave', handlePanelCloseMouseLeave);
  panelCloseBtn.addEventListener('click', closeWidget);
  container.appendChild(panelCloseBtn);

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
          signal: requestAbortController.signal,
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
          'x-widget-token': widgetId,
        },
        credentials: 'omit',
        signal: requestAbortController.signal,
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
      if (!destroyed) {
        console.error('[InboxPilot] Failed to init session:', err);
      }
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
    if (destroyed || togglePending) return;

    if (isOpen) {
      closeWidget();
      return;
    }

    togglePending = true;
    btn.disabled = true;

    try {
      const session = await initSession();
      if (destroyed) return;
      if (!session) {
        console.error('[InboxPilot] Could not initialize chat session.');
        return;
      }

      mountIframe(session.token, session.preChatEnabled);
      container.style.display = 'block';
      isOpen = true;
      updateLauncherIcon();
    } finally {
      togglePending = false;
      if (!destroyed) btn.disabled = false;
    }
  }

  function handleLauncherClick() {
    void toggleWidget();
  }

  btn.addEventListener('click', handleLauncherClick);

  // Listen for messages from iframe (e.g. close request, token rotation, auth failure)
  function handleWidgetMessage(event: MessageEvent) {
    if (
      event.origin !== appOrigin ||
      event.source !== iframeEl?.contentWindow
    ) return;

    if (event.data?.type === 'inboxpilot:close') {
      closeWidget();
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
      updateLauncherIcon();
    }
  }

  window.addEventListener('message', handleWidgetMessage);

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    requestAbortController.abort();

    window.removeEventListener('message', handleWidgetMessage);
    btn.removeEventListener('mouseenter', handleLauncherMouseEnter);
    btn.removeEventListener('mouseleave', handleLauncherMouseLeave);
    btn.removeEventListener('click', handleLauncherClick);
    panelCloseBtn.removeEventListener('mouseenter', handlePanelCloseMouseEnter);
    panelCloseBtn.removeEventListener('mouseleave', handlePanelCloseMouseLeave);
    panelCloseBtn.removeEventListener('click', closeWidget);

    iframeEl?.remove();
    iframeEl = null;
    btn.remove();
    container.remove();
    isOpen = false;

    if (widgetWindow.InboxPilotWidget === widgetApi) {
      delete widgetWindow.InboxPilotWidget;
    }
  }

  const widgetApi: InboxPilotWidgetApi = { destroy };

  // ---------------------------------------------------------------------------
  // Mount elements
  // ---------------------------------------------------------------------------

  document.body.appendChild(btn);
  document.body.appendChild(container);
  widgetWindow.InboxPilotWidget = widgetApi;
})();

export {};
