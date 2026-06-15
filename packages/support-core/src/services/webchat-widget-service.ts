/**
 * WebchatWidgetService — orchestrates webchat widget configuration management.
 *
 * Provides:
 * - removeWidget: deletes a widget and (via the FK cascade in 005_webchat.sql) its
 *   associated `webchat_thread` rows. Enforces that the widget belongs to the
 *   caller's organization before deletion, and records an audit log entry.
 *
 * The widget configuration is currently mutated directly from the browser in the
 * settings UI (create, toggle active) — see `app/settings/_components/`. This
 * service exists to bring destructive admin actions in line with the canonical
 * pattern used by `OrganizationService`: route handler → service → audit log.
 *
 * Records audit log entries for each action.
 * This service never imports InsForge SDK — all dependencies are injected.
 */

import type { WebchatWidgetRepository } from '../repositories/webchat-widget-repository.js';
import type { AuditLogRepository } from '../repositories/audit-log-repository.js';

export class WebchatWidgetService {
  constructor(
    private widgetRepo: WebchatWidgetRepository,
    private auditLog: AuditLogRepository,
  ) {}

  /**
   * Delete a webchat widget, scoped to the caller's organization.
   *
   * The FK cascade in `005_webchat.sql` wipes every `webchat_thread` linked to
   * this widget (via `webchat_threads.widget_id REFERENCES webchat_widgets(id)
   * ON DELETE CASCADE`). The thread's `conversations` and `contacts` rows are
   * NOT cascade-deleted by this path — the cascade clauses on
   * `webchat_threads.conversation_id` and `webchat_threads.contact_id` only fire
   * in the *reverse* direction (deleting a conversation cascades to its threads,
   * not the other way around). Those rows become orphaned-but-still-present.
   * The audit log is the only surviving record of the widget's existence.
   *
   * The `organizationId` parameter is the org the caller is authorized against;
   * it must match the widget's own `organizationId`. This guards against an
   * admin in Org A passing a `widgetId` from Org B while authorized against
   * Org A (RLS is bypassed by the service-role client used in the API route).
   *
   * @param organizationId - The organization the caller is authorized against
   * @param widgetId - The widget ID to delete
   * @param actorId - The user ID performing the action (recorded in the audit log)
   * @throws Error if the widget does not exist or belongs to a different organization
   */
  async removeWidget(
    organizationId: string,
    widgetId: string,
    actorId: string,
  ): Promise<void> {
    const widget = await this.widgetRepo.findById(widgetId);

    // Defensive: refuse to delete a widget that doesn't belong to the
    // organization the caller is authorized against. The route's
    // `userHasOrgPermission` check proves the caller has `manage_settings` in
    // `organizationId`, but the widgetId in the body could reference a widget
    // in any tenant (RLS is bypassed by the service-role client).
    if (!widget || widget.organizationId !== organizationId) {
      throw new Error(`Widget ${widgetId} not found`);
    }

    await this.widgetRepo.delete(widgetId);

    await this.auditLog.create({
      organizationId: widget.organizationId,
      actorId,
      actorType: 'user',
      action: 'webchat_widget_deleted',
      resourceType: 'webchat_widget',
      resourceId: widgetId,
      metadata: {
        name: widget.name,
        wasActive: widget.isActive,
      },
    });
  }
}
