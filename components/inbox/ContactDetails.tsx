'use client';

import type { ContactRow, ConversationRow } from './ConversationItem';
import { StatusBadge } from './StatusBadge';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function channelLabel(channel: string): string {
  return channel === 'sms' ? 'SMS' : 'Email';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ContactDetailsProps {
  conversation: ConversationRow;
}

export function ContactDetails({ conversation }: ContactDetailsProps) {
  const contact: ContactRow | null = conversation.contacts;

  return (
    <div className="space-y-4">
      {/* Contact info */}
      <div>
        <h4 className="text-label-md text-gray-700 mb-2">Contact</h4>
        <dl className="space-y-2.5">
          <div>
            <dt className="text-label-sm text-gray-500">Name</dt>
            <dd className="mt-0.5 text-body-sm text-gray-900">
              {contact?.name ?? 'Unknown'}
            </dd>
          </div>

          {contact?.email && (
            <div>
              <dt className="text-label-sm text-gray-500">Email</dt>
              <dd className="mt-0.5 text-body-sm text-gray-900 truncate">{contact.email}</dd>
            </div>
          )}

          {contact?.phone && (
            <div>
              <dt className="text-label-sm text-gray-500">Phone</dt>
              <dd className="mt-0.5 text-body-sm text-gray-900">{contact.phone}</dd>
            </div>
          )}

          {contact?.created_at && (
            <div>
              <dt className="text-label-sm text-gray-500">Customer since</dt>
              <dd className="mt-0.5 text-body-sm text-gray-900">{formatDate(contact.created_at)}</dd>
            </div>
          )}
        </dl>
      </div>

      <hr className="border-surface-border" />

      {/* Conversation info */}
      <div>
        <h4 className="text-label-md text-gray-700 mb-2">Conversation</h4>
        <dl className="space-y-2.5">
          <div>
            <dt className="text-label-sm text-gray-500">Channel</dt>
            <dd className="mt-0.5 text-body-sm text-gray-900">{channelLabel(conversation.channel)}</dd>
          </div>

          <div>
            <dt className="text-label-sm text-gray-500">Status</dt>
            <dd className="mt-1">
              <StatusBadge status={conversation.status} />
            </dd>
          </div>

          {conversation.subject && (
            <div>
              <dt className="text-label-sm text-gray-500">Subject</dt>
              <dd className="mt-0.5 text-body-sm text-gray-900">{conversation.subject}</dd>
            </div>
          )}

          <div>
            <dt className="text-label-sm text-gray-500">ID</dt>
            <dd className="mt-0.5 text-mono-sm text-gray-600 font-mono">
              #{conversation.id.slice(0, 8)}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
