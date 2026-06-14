'use client';

import { useConversationAuditTrail } from '@/lib/queries/hooks/useConversationAuditTrail';

// ---------------------------------------------------------------------------
// AuditTab — M03 right-panel "Audit" tab body.
//
// Vertical timeline of audit-log events for a single conversation. The
// underlying data source is the `useConversationAuditTrail` orchestrator
// (see its JSDoc for the full multi-pronged source story); this component
// only renders the deduplicated, time-sorted slice it returns.
//
// ## Why "writer gap" note?
//
// Only 4 of the 22 known audit-log writers populate
// `metadata.conversationId` — the rest tag their events by foreign key
// (`resource_type` + `resource_id`) pointing either at the conversation
// itself, one of its `ai_decision`s, or one of its `message`s. The
// multi-pronged orchestrator catches the rest via FK joins, but a
// handful of action strings (`ai_draft_regenerated`,
// `conversation_escalated`, `conversation_resolved`,
// `conversation_reopened`) are *referenced* in the audit catalog and
// emitted by the API routes' intent, but **not yet written** to the
// `audit_logs` table (see `docs/reference/audit.md` "Known gaps"). The
// top-of-tab note sets that user expectation up front.
//
// ## 100-row cap
//
// The orchestrator caps the rendered slice at 100 rows to match the
// `useAuditLogs` internal limit. Beyond that, the timeline is silent —
// we don't paginate, and the "View full log" link lives on the
// `/settings?tab=audit` page where the full filterable grid is rendered
// by `AuditLogSettingsPanel`.
// ---------------------------------------------------------------------------

interface AuditTabProps {
  conversationId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map an audit `action` string to a human-readable label. Covers every
 * string in the `docs/reference/audit.md` action catalog — the 12 known
 * actions plus the 4 referenced-but-not-yet-emitted "gap" actions.
 *
 * Unknown actions fall back to title-casing: replace `_` with a space and
 * capitalise the first letter of every word, so a future writer is at
 * least readable when it lands in the timeline.
 */
function humanizeAction(action: string): string {
  const KNOWN: Record<string, string> = {
    message_received: 'Message received',
    message_sent: 'Message sent',
    ai_draft_approved: 'AI draft approved',
    ai_decision_produced: 'AI decision produced',
    organization_created: 'Organization created',
    member_added: 'Member added',
    member_role_changed: 'Member role changed',
    member_removed: 'Member removed',
    knowledge_document_processed: 'Knowledge document processed',
    knowledge_document_failed: 'Knowledge document failed',
    webchat_thread_created: 'Webchat thread created',
    webchat_thread_identified: 'Webchat thread identified',
    // Gap actions — referenced in audit.md "Known gaps", not yet emitted:
    ai_draft_regenerated: 'AI draft regenerated',
    conversation_escalated: 'Conversation escalated',
    conversation_resolved: 'Conversation resolved',
    conversation_reopened: 'Conversation reopened',
  };
  if (KNOWN[action]) return KNOWN[action];
  return action
    .split('_')
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Tailwind background class for the 24px actor rail dot.
 *   - `user`   → M03 blue
 *   - `ai`     → M03 orange
 *   - `system` → muted grey (M03 fg-3)
 *   - unknown  → muted grey (same as system; conservative default)
 */
function actorColor(actorType: 'user' | 'system' | 'ai' | string): string {
  if (actorType === 'user') return 'bg-[var(--m03-blue)]';
  if (actorType === 'ai') return 'bg-[var(--m03-orange)]';
  return 'bg-[var(--m03-fg-3)]';
}

/**
 * Render an ISO timestamp as a human-friendly local date+time string.
 * Mirrors `AuditLogSettingsPanel`'s `formatTimestamp` (medium date,
 * short time, en-US) for consistency with the full audit log grid in
 * `/settings?tab=audit`. Returns the original string on parse failure.
 */
function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AuditTab({ conversationId }: AuditTabProps) {
  const { rows, isLoading, error } = useConversationAuditTrail(conversationId);

  return (
    <div>
      {/* Writer-gap acknowledgement — kept above every state so users
          don't read "empty timeline" as "we lost data". */}
      <div className="mb-3 text-[11px] text-[var(--m03-fg-3)]">
        Some actions may not be audited yet.
      </div>

      {/* Loading state — 3 skeleton rows. */}
      {isLoading && (
        <div className="space-y-2" aria-busy="true" aria-label="Loading audit events">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-12 rounded bg-[var(--m03-line-2)] animate-pulse"
            />
          ))}
        </div>
      )}

      {/* Error state — red M03 text, no retry button (user can switch
          tabs to refetch). */}
      {error && !isLoading && (
        <div className="text-[13px] text-[var(--m03-red)]" role="alert">
          Couldn&apos;t load audit events
        </div>
      )}

      {/* Empty state — clock icon + helper text. */}
      {!isLoading && !error && rows.length === 0 && (
        <div
          className="flex flex-col items-center justify-center py-8 text-center"
          data-testid="audit-tab-empty"
        >
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-[var(--m03-fg-3)]"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <polyline points="12 7 12 12 15 14" />
          </svg>
          <p className="mt-2 text-[13px] text-[var(--m03-fg-3)]">
            No audit events for this conversation
          </p>
        </div>
      )}

      {/* Timeline rows — each row is a left-rail dot + content column. */}
      {!isLoading && !error && rows.length > 0 && (
        <ol className="space-y-2" data-testid="audit-tab-timeline">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-start gap-3"
              data-testid="audit-tab-row"
              data-actor-type={row.actor_type}
            >
              <div
                className={`mt-0.5 h-6 w-6 shrink-0 rounded-full ${actorColor(row.actor_type)}`}
                aria-hidden="true"
              />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-[var(--m03-fg)]">
                  {humanizeAction(row.action)}
                </div>
                <div className="truncate font-mono text-[10px] text-[var(--m03-fg-3)]">
                  {row.resource_type}
                  {row.resource_id && ` · ${row.resource_id}`}
                </div>
                <div className="text-[10px] text-[var(--m03-fg-3)]">
                  {formatTimestamp(row.created_at)}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
