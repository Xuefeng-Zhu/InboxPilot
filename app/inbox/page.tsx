'use client';

import { useState } from 'react';
import { AppShell } from '@/components/layout';
import { ConversationList } from '@/components/inbox/ConversationList';
import { MessageThread } from '@/components/inbox/MessageThread';
import type { ConversationStatus } from '@support-core/types';

const filterOptions: { id: ConversationStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'All Open' },
  { id: 'pending', label: 'Pending' },
  { id: 'escalated', label: 'Escalated' },
  { id: 'resolved', label: 'Resolved' },
];

export default function InboxPage() {
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ConversationStatus | 'all'>('all');

  return (
    <AppShell>
      <div className="flex flex-col lg:flex-row h-full">
        {/* Conversation List panel — 360px fixed width */}
        <div className="w-full lg:w-inbox-list-w border-b lg:border-b-0 lg:border-r border-surface-border overflow-hidden shrink-0 flex flex-col">
          {/* List header with title and filter icon */}
          <header className="flex items-center justify-between border-b border-surface-border px-4 py-3 xl:px-4">
            <h1 className="text-headline-sm text-gray-900">Inbox</h1>
            {/* Filter toggle icon */}
            <button
              className="p-1.5 rounded hover:bg-gray-50 text-gray-500 transition-colors"
              aria-label="Filter conversations"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 4h12M4 8h8M6 12h4" />
              </svg>
            </button>
          </header>

          {/* Status filter pills */}
          <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-surface-border overflow-x-auto">
            {filterOptions.map((opt) => (
              <button
                key={opt.id}
                onClick={() => setStatusFilter(opt.id)}
                className={`shrink-0 rounded-full px-3 py-1 text-label-sm font-medium transition-colors ${
                  statusFilter === opt.id
                    ? 'bg-primary text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto">
            <ConversationList
              selectedId={selectedConversationId}
              onSelect={setSelectedConversationId}
              statusFilter={statusFilter}
            />
          </div>
        </div>

        {/* Detail View — fluid width */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {selectedConversationId ? (
            <MessageThread conversationId={selectedConversationId} />
          ) : (
            <div className="flex flex-1 h-full items-center justify-center p-8">
              <div className="text-center">
                <div className="mx-auto h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center">
                  <svg
                    className="h-6 w-6 text-gray-400"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z"
                    />
                  </svg>
                </div>
                <p className="mt-3 text-body-md font-medium text-gray-500">
                  Select a conversation
                </p>
                <p className="mt-1 text-body-sm text-gray-400">
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
