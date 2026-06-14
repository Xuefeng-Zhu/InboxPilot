import { useAiDecisionsForConversation } from './useAiDecision';
import { useAuditLogs, type AuditLogRow } from './useAuditLogs';
import { useInfiniteMessages } from './useMessages';

/**
 * Multi-pronged orchestrator hook that fetches the full audit-log trail for a
 * single conversation. Returns a deduplicated, descending-time-ordered slice
 * (capped at 100 rows) of every audit event that can be linked back to the
 * conversation.
 *
 * ## Why four prongs?
 *
 * Audit-log writers in this codebase tag events inconsistently. Only 4 of the
 * 22 known writers populate `metadata.conversationId`; the rest tag their
 * events by foreign key (`resource_type` + `resource_id`) to either the
 * conversation itself, one of its `ai_decision`s, or one of its `message`s.
 * Querying by `metadata.conversationId` alone is therefore incomplete — the
 * FK-join branches pick up the gap.
 *
 * The four prongs are:
 *   1. `metadataContains: { conversationId }` — events written by the four
 *      metadata-tagging writers.
 *   2. `resourceType: 'conversation'`, `resourceId: conversationId` — events
 *      written directly against the conversation row.
 *   3. `resourceType: 'ai_decision'`, `resourceId: <all decision ids>` — events
 *      written against any of this conversation's AI decisions (requires the
 *      upstream AI-decision list to resolve before this branch fires).
 *   4. `resourceType: 'message'`, `resourceId: <all message ids>` — events
 *      written against any of this conversation's messages (requires the
 *      upstream message list to resolve before this branch fires).
 *
 * ## React Hook rules
 *
 * All 6 underlying hooks (2 ID sources + 4 audit prongs) are called
 * **unconditionally**. Each `useAuditLogs` call gates its fetch via the
 * `enabled` option on the new `useAuditLogs` second arg (Task 4) so the order
 * of hook invocations is stable across renders.
 *
 * ## Output shape
 *
 * - `rows` is deduplicated by `id`, sorted DESC by `created_at`, capped at
 *   100 entries. The cap mirrors the 100-row cap inside `useAuditLogs`
 *   itself — beyond that we'd be paginating anyway.
 * - `isLoading` reflects the aggregate of the 4 audit prongs (the ID-source
 *   hooks are internal: their loading state is irrelevant once their IDs
 *   have been collected, and their `data` transitions to defined as soon as
 *   the upstream resolves).
 * - `error` is the first non-null error from any of the 4 audit prongs, or
 *   `null` if all resolved cleanly.
 */
export function useConversationAuditTrail(conversationId: string | undefined): {
  rows: AuditLogRow[];
  isLoading: boolean;
  error: Error | null;
} {
  // ID sources — called unconditionally. `enabled` is handled inside each hook
  // via `!!conversationId`; here we only read their resolved arrays.
  const aiDecisionsQuery = useAiDecisionsForConversation(conversationId);
  const messagesQuery = useInfiniteMessages(conversationId);

  const aiDecisionIds: string[] = Array.isArray(aiDecisionsQuery.data)
    ? aiDecisionsQuery.data
        .map((row) => (row as { id?: unknown }).id)
        .filter((id): id is string => typeof id === 'string')
    : [];

  const messageIds: string[] = Array.isArray(messagesQuery.items)
    ? messagesQuery.items
        .map((row) => (row as { id?: unknown }).id)
        .filter((id): id is string => typeof id === 'string')
    : [];

  // Four audit prongs — each independently gated via `enabled`.
  const metadataQuery = useAuditLogs(
    { metadataContains: conversationId ? { conversationId } : undefined },
    { enabled: !!conversationId },
  );
  const conversationQuery = useAuditLogs(
    { resourceType: 'conversation', resourceId: conversationId },
    { enabled: !!conversationId },
  );
  const aiDecisionsQueryAudit = useAuditLogs(
    {
      resourceType: 'ai_decision',
      resourceId: aiDecisionIds.length > 0 ? aiDecisionIds : undefined,
    },
    { enabled: aiDecisionIds.length > 0 },
  );
  const messagesQueryAudit = useAuditLogs(
    {
      resourceType: 'message',
      resourceId: messageIds.length > 0 ? messageIds : undefined,
    },
    { enabled: messageIds.length > 0 },
  );

  // Dedup by `id` (later occurrences overwrite earlier ones — order is
  // metadata, conversation, ai_decision, message; the first occurrence
  // wins, which keeps the most "natural" projection per writer).
  const deduped = new Map<string, AuditLogRow>();
  for (const row of metadataQuery.data ?? []) deduped.set(row.id, row);
  for (const row of conversationQuery.data ?? []) deduped.set(row.id, row);
  for (const row of aiDecisionsQueryAudit.data ?? []) deduped.set(row.id, row);
  for (const row of messagesQueryAudit.data ?? []) deduped.set(row.id, row);

  const rows = Array.from(deduped.values())
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 100);

  const isLoading =
    metadataQuery.isLoading ||
    conversationQuery.isLoading ||
    aiDecisionsQueryAudit.isLoading ||
    messagesQueryAudit.isLoading;

  const error =
    metadataQuery.error ??
    conversationQuery.error ??
    aiDecisionsQueryAudit.error ??
    messagesQueryAudit.error ??
    null;

  return { rows, isLoading, error };
}
