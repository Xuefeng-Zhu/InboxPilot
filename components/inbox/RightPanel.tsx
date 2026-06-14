'use client';

import { useEffect } from 'react';
import { ActivityPanel, ContactDetails } from './ContactDetails';
import { useConversation, useInfiniteMessages } from '@/lib/queries';
import type { ConversationRow } from './ConversationItem';

// ---------------------------------------------------------------------------
// RightPanel — M03 right-column container.
// Sections (per Phase 5 decision: AI Draft stays inline in the thread):
//   1. Contact (centered avatar + key/value rows)
//   2. Activity (status / AI state / last msg / messages)
//
// Two render modes:
//   - Inline: hidden <xl (rendered as <aside> in the 4-col grid by the page).
//   - Drawer: <xl only, controlled by `open`.
// ---------------------------------------------------------------------------

interface RightPanelProps {
  conversationId: string;
  /** Drawer mode: render as slide-over (used on <xl). */
  open?: boolean;
  onClose?: () => void;
}

function PanelBody({ conversationId }: { conversationId: string }) {
  const { data: conversationData } = useConversation(conversationId);
  const { items: messages } = useInfiniteMessages(conversationId);
  const conversation = conversationData as ConversationRow | undefined;

  if (!conversation) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-[13px] text-[var(--m03-fg-3)]">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3.5 p-4">
      <ContactDetails conversation={conversation} />
      <ActivityPanel
        conversation={conversation}
        lastMessageAt={conversation.last_message_at}
        messageCount={Array.isArray(messages) ? messages.length : undefined}
      />
    </div>
  );
}

export function RightPanel({ conversationId, open, onClose }: RightPanelProps) {
  useEffect(() => {
    if (open === undefined || !open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (open === undefined) {
    return (
      <aside className="hidden w-right-panel-w shrink-0 overflow-hidden border-l border-[var(--m03-line)] bg-white xl:block">
        <div className="h-full overflow-y-auto">
          <PanelBody conversationId={conversationId} />
        </div>
      </aside>
    );
  }

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity xl:hidden ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`fixed inset-y-0 right-0 z-50 w-right-panel-w max-w-[90vw] transform bg-white shadow-xl transition-transform duration-200 ease-out xl:hidden ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Conversation details"
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-[var(--m03-line)] px-4 py-3">
            <h2 className="text-[13px] font-semibold text-[var(--m03-fg)]">Conversation details</h2>
            <button
              onClick={onClose}
              className="rounded p-1 text-[var(--m03-fg-3)] transition-colors hover:bg-[var(--m03-line-2)]"
              aria-label="Close details"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M3 3l8 8M11 3l-8 8" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <PanelBody conversationId={conversationId} />
          </div>
        </div>
      </div>
    </>
  );
}
