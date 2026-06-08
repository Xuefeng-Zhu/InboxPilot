'use client';

import { useCallback } from 'react';

interface OpenChatButtonProps {
  children: React.ReactNode;
  className?: string;
  fallbackHref?: string;
}

const WIDGET_BUTTON_ID = 'inboxpilot-widget-btn';
const RETRY_DELAY_MS = 400;
const MAX_RETRIES = 5;

export function OpenChatButton({
  children,
  className,
  fallbackHref = '/register',
}: OpenChatButtonProps) {
  const handleClick = useCallback(
    async (e: React.MouseEvent<HTMLAnchorElement>) => {
      for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
        const btn = document.getElementById(WIDGET_BUTTON_ID);
        if (btn) {
          e.preventDefault();
          btn.click();
          return;
        }
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    },
    [],
  );

  return (
    <a href={fallbackHref} onClick={handleClick} className={className}>
      {children}
    </a>
  );
}
