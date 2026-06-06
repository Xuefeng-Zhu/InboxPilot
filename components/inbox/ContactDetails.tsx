'use client';

import type { ContactRow, ConversationRow } from './ConversationItem';
import { StatusBadge } from './StatusBadge';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function channelLabel(channel: string): string {
  return channel === 'sms' ? 'SMS' : 'Email';
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
    <aside
      className="w-64 shrink-0 border-l border-gray-200 bg-white p-4 overflow-y-auto"
      aria-label="Contact details"
    >
      <h3 className="text-sm font-semibold text-gray-900">Contact Details</h3>

      <dl className="mt-3 space-y-3 text-sm">
        {/* Name */}
        <div>
          <dt className="text-xs font-medium text-gray-500">Name</dt>
          <dd className="mt-0.5 text-gray-900">
            {contact?.name ?? 'Unknown'}
          </dd>
        </div>

        {/* Email */}
        {contact?.email && (
          <div>
            <dt className="text-xs font-medium text-gray-500">Email</dt>
            <dd className="mt-0.5 truncate text-gray-900">{contact.email}</dd>
          </div>
        )}

        {/* Phone */}
        {contact?.phone && (
          <div>
            <dt className="text-xs font-medium text-gray-500">Phone</dt>
            <dd className="mt-0.5 text-gray-900">{contact.phone}</dd>
          </div>
        )}
      </dl>

      <hr className="my-4 border-gray-100" />

      <h3 className="text-sm font-semibold text-gray-900">Conversation</h3>

      <dl className="mt-3 space-y-3 text-sm">
        {/* Channel */}
        <div>
          <dt className="text-xs font-medium text-gray-500">Channel</dt>
          <dd className="mt-0.5 text-gray-900">{channelLabel(conversation.channel)}</dd>
        </div>

        {/* Status */}
        <div>
          <dt className="text-xs font-medium text-gray-500">Status</dt>
          <dd className="mt-1">
            <StatusBadge status={conversation.status} />
          </dd>
        </div>

        {/* Subject (email only) */}
        {conversation.subject && (
          <div>
            <dt className="text-xs font-medium text-gray-500">Subject</dt>
            <dd className="mt-0.5 text-gray-900">{conversation.subject}</dd>
          </div>
        )}
      </dl>
    </aside>
  );
}
