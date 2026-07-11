'use client';

import { useEffect } from 'react';

interface InboxPilotWidgetApi {
  destroy: () => void;
}

declare global {
  interface Window {
    InboxPilotWidget?: InboxPilotWidgetApi;
  }
}

export function LandingWidget({ widgetId }: { widgetId: string }) {
  useEffect(() => {
    if (!widgetId) return;

    let disposed = false;
    window.InboxPilotWidget?.destroy();

    const script = document.createElement('script');
    script.id = 'inboxpilot-landing-widget';
    script.src = '/widget.js';
    script.async = true;
    script.dataset.widgetId = widgetId;
    script.dataset.position = 'bottom-right';
    script.dataset.color = '#0070f3';

    const handleLoad = () => {
      if (disposed) window.InboxPilotWidget?.destroy();
    };

    script.addEventListener('load', handleLoad);
    document.body.appendChild(script);

    return () => {
      disposed = true;
      script.removeEventListener('load', handleLoad);
      window.InboxPilotWidget?.destroy();
      script.remove();
    };
  }, [widgetId]);

  return null;
}
