/**
 * POST /api/functions/delete-widget
 *
 * Body: { organizationId: string, widgetId: string }
 * Required permission: 'manage_settings'
 *
 * Deletes a webchat widget. The FK cascade in 005_webchat.sql
 * (`webchat_threads.widget_id REFERENCES webchat_widgets(id) ON DELETE CASCADE`)
 * removes every `webchat_thread` linked to this widget. The thread's
 * `conversations` and `contacts` rows are NOT cascade-deleted by this path —
 * the cascade clauses on those FKs only fire in the reverse direction
 * (deleting a conversation cascades to its threads). The widget's audit log
 * is the only surviving record of its existence.
 *
 * Delegates to WebchatWidgetService.removeWidget, which:
 *  - asserts the widget exists and belongs to the caller's organization
 *    (throws "Widget {id} not found" otherwise — this is the cross-tenant guard)
 *  - records a 'webchat_widget_deleted' audit log entry (with the caller as actor)
 */
import { NextRequest, NextResponse } from 'next/server';
import { readRequestJsonObject } from '@/lib/http-json';
import { getUserFromToken, userHasOrgPermission } from '../_auth';
import { createInsforgeDbAdapter } from '../_insforge-db-adapter';
import { WebchatWidgetService } from '@support-core/services/webchat-widget-service';
import { WebchatWidgetRepository } from '@support-core/repositories/webchat-widget-repository';
import { AuditLogRepository } from '@support-core/repositories/audit-log-repository';

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromToken(req);
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const requestBody = await readRequestJsonObject(req);
    if (!requestBody) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { organizationId, widgetId } = requestBody;

    if (typeof organizationId !== 'string' || typeof widgetId !== 'string') {
      return NextResponse.json(
        { error: 'organizationId and widgetId are required' },
        { status: 400 },
      );
    }

    const allowed = await userHasOrgPermission(
      user.id,
      organizationId,
      'manage_settings',
    );
    if (!allowed) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const db = createInsforgeDbAdapter();
    const widgetRepo = new WebchatWidgetRepository(db);
    const auditRepo = new AuditLogRepository(db);
    const widgetService = new WebchatWidgetService(widgetRepo, auditRepo);

    await widgetService.removeWidget(organizationId, widgetId, user.id);

    return NextResponse.json({ data: { deleted: true } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    const status =
      message.toLowerCase().includes('not found') ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
