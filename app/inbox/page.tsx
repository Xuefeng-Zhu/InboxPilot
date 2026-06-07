'use client';

import { useState } from 'react';
import { AppShell } from '@/components/layout';
import { ConversationList } from '@/components/inbox/ConversationList';
import { MessageThread } from '@/components/inbox/MessageThread';

export default function InboxPage() {
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);

  return (
    <AppShell>
      <div className="flex flex-col lg:flex-row h-full">
        {/* Conversation List — 360px fixed width at lg+, full width stacked below lg */}
        <div className="w-full lg:w-inbox-list-w border-b lg:border-b-0 lg:border-r border-surface-border overflow-y-auto shrink-0">
          <header className="flex items-center justify-between border-b border-surface-border px-4 py-3">
            <h1 className="text-lg font-semibold text-gray-900">Inbox</h1>
          </header>
          <ConversationList
            selectedId={selectedConversationId}
            onSelect={setSelectedConversationId}
          />
        </div>

        {/* Detail View — fluid width */}
        <div className="flex-1 overflow-y-auto">
          {selectedConversationId ? (
            <MessageThread conversationId={selectedConversationId} />
          ) : (
            <div className="flex flex-1 h-full items-center justify-center p-8">
              <div className="text-center">
                <svg
                  className="mx-auto h-12 w-12 text-gray-300"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1}
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z"
                  />
                </svg>
                <p className="mt-2 text-sm font-medium text-gray-500">
                  Select a conversation
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  Choose a conversation from the list to view messages.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
