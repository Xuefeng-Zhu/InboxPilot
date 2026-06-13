import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { AuditLogRepository } from '../../src/repositories/audit-log-repository.js';

/**
 * Property 15: Audit log immutability
 *
 * For any audit log entry, once created, UPDATE and DELETE operations on that
 * entry SHALL be rejected. The audit_logs table SHALL be append-only.
 *
 * **Validates: Requirements 22.3**
 *
 * We verify this by confirming that the AuditLogRepository class exposes only
 * a `create` method and does NOT expose `update` or `delete` methods. This
 * ensures the repository layer enforces append-only semantics at the code level.
 * Combined with the RLS policy (003_rls_policies.sql) that blocks UPDATE and
 * DELETE on audit_logs, this provides defense-in-depth immutability.
 */

// ─── Arbitrary generators ────────────────────────────────────────────

const actorTypeArb = fc.constantFrom('user' as const, 'system' as const, 'ai' as const);

const auditLogInputArb = fc.record({
  organizationId: fc.uuid(),
  actorId: fc.option(fc.uuid(), { nil: null }),
  actorType: actorTypeArb,
  action: fc.stringOf(fc.constantFrom(
    'message_sent',
    'message_received',
    'ai_decision_produced',
    'conversation_escalated',
    'conversation_resolved',
    'conversation_reopened',
    'settings_changed',
    'member_added',
    'member_removed',
    'member_role_changed',
    'knowledge_document_created',
    'knowledge_document_deleted',
    'provider_account_modified',
  ), { minLength: 1, maxLength: 1 }).map((s) => s),
  resourceType: fc.constantFrom(
    'message',
    'conversation',
    'ai_decision',
    'ai_settings',
    'organization_member',
    'knowledge_document',
    'sms_provider_account',
    'email_provider_account',
  ),
  resourceId: fc.option(fc.uuid(), { nil: null }),
  metadata: fc.constant({}),
});

describe('Property 15: Audit log immutability', () => {
  it('AuditLogRepository SHALL NOT expose update or delete methods — append-only', () => {
    fc.assert(
      fc.property(auditLogInputArb, (_input) => {
        // Verify the AuditLogRepository prototype has only `create` as a write method
        const protoMethods = Object.getOwnPropertyNames(AuditLogRepository.prototype)
          .filter((name) => name !== 'constructor');

        // The repository MUST have a `create` method
        expect(protoMethods).toContain('create');

        // The repository MUST NOT have `update` or `delete` methods
        expect(protoMethods).not.toContain('update');
        expect(protoMethods).not.toContain('delete');
        expect(protoMethods).not.toContain('remove');
        expect(protoMethods).not.toContain('destroy');
        expect(protoMethods).not.toContain('patch');

        // Verify the only public method is `create` (append-only)
        const writeMethods = protoMethods.filter(
          (m) => m !== 'create',
        );
        // No other write methods should exist
        for (const method of writeMethods) {
          // Any additional methods must be read-only (e.g., find, list)
          expect(['update', 'delete', 'remove', 'destroy', 'patch']).not.toContain(method);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('AuditLogRepository instance SHALL only allow creating entries, never modifying or deleting', () => {
    fc.assert(
      fc.property(auditLogInputArb, (_input) => {
        // Create a mock database client
        const mockDb = {
          from: () => ({
            insert: () => ({
              select: () => ({
                single: () => Promise.resolve({ data: null, error: null }),
              }),
            }),
          }),
          rpc: () => Promise.resolve({ data: null, error: null }),
        };

        const repo = new AuditLogRepository(mockDb as never);

        // The repo instance MUST have `create`
        expect(typeof repo.create).toBe('function');

        // The repo instance MUST NOT have `update` or `delete`
        const repoShape = repo as unknown as Record<string, unknown>;
        expect(repoShape['update']).toBeUndefined();
        expect(repoShape['delete']).toBeUndefined();
        expect(repoShape['remove']).toBeUndefined();
        expect(repoShape['destroy']).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });
});
