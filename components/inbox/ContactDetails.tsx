'use client';

import type { ContactRow, ConversationRow } from './ConversationItem';
import { StatusBadge } from '@/components/ui';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function channelLabel(channel: string): string {
  if (channel === 'sms') return 'SMS';
  if (channel === 'webchat') return 'Webchat';
  return 'Email';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function getInitials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return name.slice(0, 1).toUpperCase();
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--m03-fg-3)]">
      {children}
    </h3>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-[var(--m03-line)] bg-white p-3">
      {children}
    </div>
  );
}

function KeyValueRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1 text-[12px]">
      <span className="text-[var(--m03-fg-3)]">{label}</span>
      <span className="font-mono text-[11px] text-[var(--m03-fg)]">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ContactDetailsProps {
  conversation: ConversationRow;
  /** Compact mode hides the heading + uses smaller padding (used in drawer). */
  compact?: boolean;
}

export function ContactDetails({ conversation, compact = false }: ContactDetailsProps) {
  const contact: ContactRow | null = conversation.contacts;
  const displayName = contact?.name ?? 'Unknown Contact';
  const initials = getInitials(contact?.name);

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3.5'}>
      {!compact && <SectionHeading>Contact</SectionHeading>}

      <Card>
        <div className="flex flex-col items-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--m03-fg)] text-[18px] font-semibold text-[var(--m03-bg)]">
            {initials}
          </div>
          <p className="text-[14px] font-semibold text-[var(--m03-fg)]">{displayName}</p>
          <p className="mb-3 font-mono text-[11px] text-[var(--m03-fg-3)]">
            {conversation.channel === 'webchat' ? 'Visitor' : 'Customer'} · since{' '}
            {contact?.created_at ? formatDate(contact.created_at) : '—'}
          </p>

          <div className="w-full">
            <KeyValueRow label="Phone" value={contact?.phone ?? '—'} />
            <KeyValueRow label="Email" value={contact?.email ?? '—'} />
            <KeyValueRow
              label="Customer ID"
              value={
                <span className="font-mono text-[11px]">cust_{contact?.id.slice(0, 6) ?? '—'}</span>
              }
            />
            <KeyValueRow
              label="First seen"
              value={contact?.created_at ? formatDate(contact.created_at) : '—'}
            />
          </div>
        </div>
      </Card>

      {!compact && (
        <>
          <SectionHeading>Conversation</SectionHeading>
          <Card>
            <KeyValueRow label="Channel" value={channelLabel(conversation.channel)} />
            <div className="flex items-center justify-between py-1 text-[12px]">
              <span className="text-[var(--m03-fg-3)]">Status</span>
              <StatusBadge status={conversation.status} />
            </div>
            {conversation.subject && (
              <KeyValueRow label="Subject" value={conversation.subject} />
            )}
            <KeyValueRow
              label="ID"
              value={<span className="font-mono text-[11px]">#{conversation.id.slice(0, 8)}</span>}
            />
          </Card>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ActivityPanel — M03 right-panel Activity card
// ---------------------------------------------------------------------------

interface ActivityPanelProps {
  conversation: ConversationRow;
  lastMessageAt: string | null;
  messageCount?: number;
}

export function ActivityPanel({ conversation, lastMessageAt, messageCount }: ActivityPanelProps) {
  const lastMsgAgo = lastMessageAt
    ? formatRelative(lastMessageAt)
    : '—';

  return (
    <div className="space-y-3.5">
      <SectionHeading>Activity</SectionHeading>
      <Card>
        <KeyValueRow label="Status" value={conversation.status} />
        <KeyValueRow label="AI state" value={conversation.ai_state} />
        <KeyValueRow label="Last msg" value={lastMsgAgo} />
        <KeyValueRow label="Messages" value={messageCount ?? '—'} />
        <KeyValueRow label="Channel" value={channelLabel(conversation.channel)} />
      </Card>
    </div>
  );
}

function formatRelative(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
