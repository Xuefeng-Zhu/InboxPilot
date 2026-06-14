/**
 * Contact-display + channel-label helpers for the kanban row.
 *
 * WHY extracted here (not imported from `components/inbox/ConversationItem.tsx`):
 *   The task brief offered two reuse paths — import the helpers from the
 *   inbox component OR copy them into the kanban folder. We chose copy
 *   to keep the kanban folder self-contained: every kanban file under
 *   `app/inbox/kanban/` reads from `app/inbox/kanban/_lib/...` and
 *   `app/inbox/kanban/_components/...`, never from `components/inbox/...`.
 *   If the inbox list view ever changes its contact-display logic, the
 *   kanban row keeps its own behavior until intentionally re-synced.
 *
 * WHY a narrow local `KanbanContact` type (not `as any` on `contacts`):
 *   `ConversationListItem.contacts` is typed `Record<string, unknown> | null`
 *   (PostgREST "shape" rows), so the four fields this helper needs
 *   (`id`, `name`, `phone`, `email`) are `unknown` to the compiler. The
 *   cast `conversation.contacts as KanbanContact | null` is a precise
 *   structural cast — it names the exact fields we read, and a field
 *   rename in InsForge would surface as a type error at the cast site,
 *   not at runtime. No `as any`, no `@ts-ignore`.
 *
 * WHY `channelLabel` accepts `string` (not `Channel`):
 *   `ConversationListItem.channel` is also widened to `string` (the
 *   InsForge row type). Mirroring the original semantics — 'sms' → 'SMS',
 *   'webchat' → 'WEB', everything else (including the 'email' literal
 *   and any unknown string) → 'EMAIL' — works identically on `string`.
 *   No narrowing or assertion needed at the call site.
 */

import type { ConversationListItem } from '@/lib/queries/keys';

type KanbanContact = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
};

function getShortIdentifier(id: string): string {
  return id.slice(0, 8);
}

/**
 * Display name for a conversation's contact.
 *
 * Precedence (matches `components/inbox/ConversationItem.tsx:54-63`):
 *   1. `contact.name`                — explicit name wins
 *   2. channel-specific fallback     — phone for sms, email for email
 *   3. `webchat` special case        — email, else `Visitor #<id-prefix>`
 *   4. any-of phone/email            — last-resort
 *   5. `'Unknown Contact'`           — null contact or all fields empty
 */
export function getContactDisplayName(conversation: ConversationListItem): string {
  const contact = conversation.contacts as KanbanContact | null;
  const { channel } = conversation;
  if (!contact) return 'Unknown Contact';
  if (contact.name) return contact.name;
  if (channel === 'sms' && contact.phone) return contact.phone;
  if (channel === 'email' && contact.email) return contact.email;
  if (channel === 'webchat') {
    return contact.email ?? `Visitor #${getShortIdentifier(contact.id)}`;
  }
  return contact.phone ?? contact.email ?? 'Unknown Contact';
}

/**
 * Short label for a channel, used by the channel pill in the row.
 *
 *   `sms`      → 'SMS'
 *   `webchat`  → 'WEB'
 *   anything   → 'EMAIL'  (includes the `email` literal and unknown strings)
 */
export function channelLabel(channel: string): string {
  if (channel === 'sms') return 'SMS';
  if (channel === 'webchat') return 'WEB';
  return 'EMAIL';
}
