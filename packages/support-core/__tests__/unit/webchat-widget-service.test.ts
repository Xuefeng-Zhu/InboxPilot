import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebchatWidgetService } from '../../src/services/webchat-widget-service.js';
import type { WebchatWidgetRepository } from '../../src/repositories/webchat-widget-repository.js';
import type { AuditLogRepository } from '../../src/repositories/audit-log-repository.js';
import type { WebchatWidget, AuditLog } from '../../src/types/index.js';

/**
 * Unit tests for WebchatWidgetService.
 *
 * Verifies the delete flow:
 *  - looks up the widget, enforces that it belongs to the caller's org
 *  - throws when the widget doesn't exist
 *  - throws when the widget exists but belongs to a different org (cross-tenant guard)
 *  - deletes + writes audit log when it does belong to the caller's org
 *  - audit log captures name + wasActive state
 */

// ─── Fixtures ─────────────────────────────────────────────────────

const ORG_ID = 'org-001';
const WIDGET_ID = 'widget-001';
const ACTOR_ID = 'user-001';

const SAMPLE_WIDGET: WebchatWidget = {
  id: WIDGET_ID,
  organizationId: ORG_ID,
  name: 'Marketing site widget',
  widgetToken: 'wt_abc',
  hmacSecret: 'hmac_secret_xyz',
  allowedDomains: ['example.com'],
  position: 'bottom-right',
  primaryColor: '#2563eb',
  greeting: 'Hi!',
  preChatEnabled: true,
  aiModeOverride: null,
  isActive: true,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const SAMPLE_AUDIT_LOG: AuditLog = {
  id: 'audit-001',
  organizationId: ORG_ID,
  actorId: ACTOR_ID,
  actorType: 'user',
  action: 'webchat_widget_deleted',
  resourceType: 'webchat_widget',
  resourceId: WIDGET_ID,
  metadata: { name: SAMPLE_WIDGET.name, wasActive: SAMPLE_WIDGET.isActive },
  createdAt: new Date(),
};

// ─── Mock Factories ───────────────────────────────────────────────

function createMockWidgetRepo(): WebchatWidgetRepository {
  return {
    findById: vi.fn().mockResolvedValue(SAMPLE_WIDGET),
    findByWidgetToken: vi.fn(),
    listByOrg: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn().mockResolvedValue(undefined),
  } as unknown as WebchatWidgetRepository;
}

function createMockAuditLog(): AuditLogRepository {
  return {
    create: vi.fn().mockResolvedValue(SAMPLE_AUDIT_LOG),
  } as unknown as AuditLogRepository;
}

// ─── Tests ────────────────────────────────────────────────────────

describe('WebchatWidgetService', () => {
  let widgetRepo: ReturnType<typeof createMockWidgetRepo>;
  let auditLog: ReturnType<typeof createMockAuditLog>;
  let service: WebchatWidgetService;

  beforeEach(() => {
    widgetRepo = createMockWidgetRepo();
    auditLog = createMockAuditLog();
    service = new WebchatWidgetService(widgetRepo, auditLog);
  });

  describe('removeWidget', () => {
    it('looks up the widget by id before deleting', async () => {
      await service.removeWidget(ORG_ID, WIDGET_ID, ACTOR_ID);

      expect(widgetRepo.findById).toHaveBeenCalledWith(WIDGET_ID);
    });

    it('deletes the widget after a successful org-scoped lookup', async () => {
      await service.removeWidget(ORG_ID, WIDGET_ID, ACTOR_ID);

      expect(widgetRepo.delete).toHaveBeenCalledWith(WIDGET_ID);
    });

    it('records a webchat_widget_deleted audit log entry with the actor as the user', async () => {
      await service.removeWidget(ORG_ID, WIDGET_ID, ACTOR_ID);

      expect(auditLog.create).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        actorId: ACTOR_ID,
        actorType: 'user',
        action: 'webchat_widget_deleted',
        resourceType: 'webchat_widget',
        resourceId: WIDGET_ID,
        metadata: { name: SAMPLE_WIDGET.name, wasActive: SAMPLE_WIDGET.isActive },
      });
    });

    it('throws "Widget not found" and skips delete + audit when the widget does not exist', async () => {
      vi.mocked(widgetRepo.findById).mockResolvedValueOnce(null);

      await expect(
        service.removeWidget(ORG_ID, WIDGET_ID, ACTOR_ID),
      ).rejects.toThrow(`Widget ${WIDGET_ID} not found`);

      expect(widgetRepo.delete).not.toHaveBeenCalled();
      expect(auditLog.create).not.toHaveBeenCalled();
    });

    it('throws "Widget not found" and skips delete + audit when the widget belongs to a different org (cross-tenant guard)', async () => {
      // Org A admin passes organizationId of Org A, but the widgetId
      // resolves to a widget that lives in Org B. Without this guard, the
      // service-role client would delete the cross-tenant widget and write
      // a foreign audit log row. The guard refuses the call.
      const foreignWidget: WebchatWidget = { ...SAMPLE_WIDGET, organizationId: 'org-OTHER' };
      vi.mocked(widgetRepo.findById).mockResolvedValueOnce(foreignWidget);

      await expect(
        service.removeWidget(ORG_ID, WIDGET_ID, ACTOR_ID),
      ).rejects.toThrow(`Widget ${WIDGET_ID} not found`);

      expect(widgetRepo.delete).not.toHaveBeenCalled();
      expect(auditLog.create).not.toHaveBeenCalled();
    });

    it('does not falsely reject when the widget\'s org matches the requested org', async () => {
      // Locks in the inverse: the guard is not over-eager. A widget whose
      // organizationId matches the requested orgId must still be deletable.
      const ownOrgWidget: WebchatWidget = { ...SAMPLE_WIDGET, organizationId: ORG_ID };
      vi.mocked(widgetRepo.findById).mockResolvedValueOnce(ownOrgWidget);

      await expect(
        service.removeWidget(ORG_ID, WIDGET_ID, ACTOR_ID),
      ).resolves.toBeUndefined();

      expect(widgetRepo.delete).toHaveBeenCalledWith(WIDGET_ID);
      expect(auditLog.create).toHaveBeenCalledTimes(1);
    });

    it('captures the widget\'s isActive state in the audit metadata (so we can see whether an active widget was destroyed)', async () => {
      const inactiveWidget: WebchatWidget = { ...SAMPLE_WIDGET, isActive: false };
      vi.mocked(widgetRepo.findById).mockResolvedValueOnce(inactiveWidget);

      await service.removeWidget(ORG_ID, WIDGET_ID, ACTOR_ID);

      const auditCall = vi.mocked(auditLog.create).mock.calls[0]?.[0];
      expect(auditCall?.metadata).toEqual({
        name: SAMPLE_WIDGET.name,
        wasActive: false,
      });
    });
  });
});
