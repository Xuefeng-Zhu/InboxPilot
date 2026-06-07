/**
 * Pure payload builders for the Knowledge page's "Add Document" action.
 *
 * HIGH-7: these helpers exist so the knowledge_documents insert payload
 * (and the follow-up audit_logs insert) are constructed from a resolved
 * `organization_id` rather than from the inserted document row (which
 * may not have `organization_id` populated client-side, and which the
 * prior code tolerated as `doc.organization_id ?? null`).
 *
 * The fix is to resolve the caller's orgId server-side from
 * `organization_members` (the same query the inbox page uses) BEFORE
 * calling insert, and pass the resolved value into both payloads. That
 * makes the audit log's `organization_id` guaranteed non-null and
 * identical to the value the row was inserted against.
 *
 * These functions are pure and side-effect-free so they can be unit
 * tested without bringing in React, InsForge, or any DB plumbing.
 */

export interface KnowledgeDocumentInsert {
  organization_id: string;
  title: string;
  source_type: string;
  body: string;
  status: 'pending';
}

export interface KnowledgeDocumentAuditLog {
  organization_id: string;
  actor_id: string;
  actor_type: 'user';
  action: 'knowledge_document_created';
  resource_type: 'knowledge_document';
  resource_id: string | null;
  metadata: { title: string };
}

/**
 * Build the row to insert into `knowledge_documents`.
 *
 * Throws if `orgId` is empty/null/undefined — callers must resolve a real
 * orgId from `organization_members` before calling this. This is the
 * HARD GUARD that prevents the HIGH-7 regression (an insert without
 * `organization_id` will be rejected by the RLS WITH CHECK policy and
 * will fail for every signed-in user).
 */
export function buildKnowledgeDocumentInsert(
  orgId: string,
  title: string,
  sourceType: string,
  body: string,
): KnowledgeDocumentInsert {
  assertOrgId(orgId);
  return {
    organization_id: orgId,
    title,
    source_type: sourceType,
    body,
    status: 'pending',
  };
}

/**
 * Build the audit-log row for a knowledge-document creation. Uses the
 * same resolved `orgId` as the insert (rather than reading it off the
 * inserted document row with a `?? null` fallback), so the audit log
 * can never be recorded against no org.
 */
export function buildKnowledgeDocumentAuditLog(
  orgId: string,
  userId: string,
  docId: string | null | undefined,
  title: string,
): KnowledgeDocumentAuditLog {
  assertOrgId(orgId);
  if (!userId) {
    throw new Error('buildKnowledgeDocumentAuditLog: userId is required');
  }
  return {
    organization_id: orgId,
    actor_id: userId,
    actor_type: 'user',
    action: 'knowledge_document_created',
    resource_type: 'knowledge_document',
    resource_id: docId ?? null,
    metadata: { title },
  };
}

function assertOrgId(orgId: string): void {
  if (typeof orgId !== 'string' || orgId.length === 0) {
    throw new Error(
      'buildKnowledgeDocumentInsert: organization_id is required ' +
        '(HIGH-7: omitting it makes the RLS WITH CHECK policy reject ' +
        'the insert for every signed-in user).',
    );
  }
}
