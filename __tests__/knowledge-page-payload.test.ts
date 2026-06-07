import { describe, it, expect } from 'vitest';
import {
  buildKnowledgeDocumentInsert,
  buildKnowledgeDocumentAuditLog,
} from '../app/knowledge/document-payload';

/**
 * Tests for HIGH-7 (docs/QA_BUG_HUNT.md).
 *
 * Bug: app/knowledge/page.tsx handleAddDocument called
 *
 *   insforge.database.from('knowledge_documents').insert({
 *     title, source_type, body, status: 'pending',
 *   })
 *
 * WITHOUT `organization_id`. The schema requires it (NOT NULL) and the
 * `knowledge_documents_insert` RLS policy requires
 *
 *   organization_id IN (SELECT user_org_ids())
 *
 * so the WITH CHECK rejects the insert for every signed-in user, leaving
 * the page non-functional. The followup audit log insert read
 * `doc.organization_id ?? null`, tolerating the missing value (which
 * means even in a hypothetical world where the doc insert succeeded, the
 * audit log would be silently recorded against no org).
 *
 * Fix: the page now resolves the caller's `organization_id` from
 * `organization_members` BEFORE the insert and uses the same value for
 * the audit log. These helpers are the single point where both payloads
 * are constructed, and these tests pin:
 *
 *   1. The insert payload always contains `organization_id` (no longer
 *      possible to construct an insert without it — the helper throws).
 *   2. The audit log uses the resolved orgId (not `doc.organization_id
 *      ?? null`), so its `organization_id` is non-null.
 *   3. The two payloads share the SAME orgId (the audit log cannot drift
 *      onto a different org from the row it audited).
 *   4. Empty-string / missing userId fails loudly instead of falling
 *      back to null/undefined.
 */
describe('buildKnowledgeDocumentInsert (HIGH-7)', () => {
  it('includes organization_id in the insert payload', () => {
    const payload = buildKnowledgeDocumentInsert(
      'org-uuid-1',
      'Return Policy FAQ',
      'faq',
      'Customers may return any unopened item within 30 days.',
    );

    expect(payload.organization_id).toBe('org-uuid-1');
  });

  it('passes through title, source_type, body verbatim', () => {
    const payload = buildKnowledgeDocumentInsert(
      'org-uuid-1',
      '  Trimmed Title  ',
      'policy',
      '  Body content.  ',
    );

    // The page trims whitespace BEFORE calling the helper, so the helper
    // itself does not trim — it must faithfully forward whatever the
    // caller passed. This pins the contract: trim upstream or not, the
    // helper does not silently mutate content.
    expect(payload.title).toBe('  Trimmed Title  ');
    expect(payload.source_type).toBe('policy');
    expect(payload.body).toBe('  Body content.  ');
  });

  it('forces status to "pending" regardless of caller', () => {
    // The helper has no status parameter at all — this is a compile-time
    // pin, but we also re-check at runtime in case someone adds an arg
    // and forgets to default it.
    const payload = buildKnowledgeDocumentInsert(
      'org-uuid-1',
      'Title',
      'faq',
      'Body',
    );
    expect(payload.status).toBe('pending');
  });

  it('throws when organization_id is the empty string (HIGH-7 guard)', () => {
    expect(() => buildKnowledgeDocumentInsert('', 'Title', 'faq', 'Body')).toThrow(
      /organization_id is required/,
    );
  });

  it('throws when organization_id is not a string', () => {
    // Cast to bypass TS to simulate a runtime bad input
    expect(() =>
      buildKnowledgeDocumentInsert(
        undefined as unknown as string,
        'Title',
        'faq',
        'Body',
      ),
    ).toThrow(/organization_id is required/);
  });

  it('regression: would have produced a broken insert prior to HIGH-7', () => {
    // This is the canary for the original bug. Before the fix, the page
    // literally wrote
    //   insert({ title, source_type, body, status: 'pending' })
    // and the resulting object had no `organization_id` key. The fix
    // funnels construction through this helper, which cannot produce an
    // object missing `organization_id` without throwing.
    const payload = buildKnowledgeDocumentInsert(
      'org-uuid-1',
      'T',
      'faq',
      'B',
    );
    expect('organization_id' in payload).toBe(true);
    expect(payload.organization_id).not.toBeNull();
    expect(payload.organization_id).not.toBeUndefined();
    expect(payload.organization_id).not.toBe('');
  });
});

describe('buildKnowledgeDocumentAuditLog (HIGH-7)', () => {
  it('uses the same orgId that was passed in (not doc.organization_id ?? null)', () => {
    const orgId = 'org-uuid-1';
    const entry = buildKnowledgeDocumentAuditLog(
      orgId,
      'user-1',
      'doc-1',
      'Return Policy',
    );

    expect(entry.organization_id).toBe(orgId);
    expect(entry.organization_id).not.toBeNull();
  });

  it('records the resource_id and metadata faithfully', () => {
    const entry = buildKnowledgeDocumentAuditLog(
      'org-uuid-1',
      'user-1',
      'doc-1',
      'My Title',
    );
    expect(entry.resource_id).toBe('doc-1');
    expect(entry.metadata).toEqual({ title: 'My Title' });
  });

  it('tolerates a missing docId by recording resource_id as null', () => {
    // The page guards on `if (inserted)` before calling the helper, but
    // even if a future caller forgets, we want a clean null rather than
    // undefined sneaking into the insert payload.
    const entry = buildKnowledgeDocumentAuditLog(
      'org-uuid-1',
      'user-1',
      null,
      'Title',
    );
    expect(entry.resource_id).toBeNull();
  });

  it('throws when organization_id is the empty string (HIGH-7 guard)', () => {
    expect(() =>
      buildKnowledgeDocumentAuditLog('', 'user-1', 'doc-1', 'Title'),
    ).toThrow(/organization_id is required/);
  });

  it('throws when userId is empty (audit log would be untraceable)', () => {
    expect(() =>
      buildKnowledgeDocumentAuditLog('org-uuid-1', '', 'doc-1', 'Title'),
    ).toThrow(/userId is required/);
  });

  it('regression: orgId in audit log matches the insert orgId, never null', () => {
    // The original bug used `doc.organization_id ?? null` on the audit
    // log, which silently null-ed the orgId. The fix uses the resolved
    // orgId. This pins that property: given any non-empty orgId, the
    // audit log's organization_id is that exact same non-null string.
    const orgId = 'org-uuid-xyz';
    const insert = buildKnowledgeDocumentInsert(orgId, 'T', 'faq', 'B');
    const audit = buildKnowledgeDocumentAuditLog(
      orgId,
      'user-1',
      'doc-1',
      'T',
    );
    expect(insert.organization_id).toBe(audit.organization_id);
    expect(audit.organization_id).toBe(orgId);
    expect(audit.organization_id).not.toBeNull();
  });
});
