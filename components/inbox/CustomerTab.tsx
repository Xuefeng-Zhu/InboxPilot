'use client';

import { ActivityPanel, ContactDetails } from './ContactDetails';
import type { ConversationRow } from './ConversationItem';

// ---------------------------------------------------------------------------
// CustomerTab — M03 right-panel "Customer" tab body.
//
// Pure visual wrapper: composes the existing `ContactDetails` + `ActivityPanel`
// cards in the same vertical stack the right panel used pre-tab-split. No new
// behavior, no new data fetching — parent (RightPanel) supplies the
// conversation + activity props.
// ---------------------------------------------------------------------------

interface CustomerTabProps {
  conversation: ConversationRow;
  lastMessageAt: string | null;
  messageCount?: number;
}

export function CustomerTab({ conversation, lastMessageAt, messageCount }: CustomerTabProps) {
  return (
    <div className="flex flex-col gap-3.5">
      <ContactDetails conversation={conversation} />
      <ActivityPanel
        conversation={conversation}
        lastMessageAt={lastMessageAt}
        messageCount={messageCount}
      />
    </div>
  );
}
