import { NextRequest, NextResponse } from 'next/server';
import { insforgeAdmin as insforge } from '@/lib/insforge-admin';
import { getUserFromToken, userHasOrgPermission } from '../_auth';
import { assertInsforgeSuccess } from '@/lib/insforge-result';
import { publishRealtimeMessage } from '@/lib/realtime-publisher';

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromToken(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { conversationId } = await req.json();
    if (!conversationId) return NextResponse.json({ error: 'Missing conversationId' }, { status: 400 });

    const conversationResult = await insforge.database
      .from('conversations')
      .select('organization_id,status')
      .eq('id', conversationId)
      .limit(1);
    assertInsforgeSuccess(conversationResult, 'reopen-conversation failed to load conversation');
    const { data: convo } = conversationResult;
    const conversation = Array.isArray(convo) ? convo[0] : convo;
    if (!conversation) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });

    const allowed = await userHasOrgPermission(
      user.id,
      conversation.organization_id as string,
      'reply_conversations',
    );
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    if (conversation.status === 'open') {
      return NextResponse.json({ status: 'ok' });
    }
    if (conversation.status !== 'resolved') {
      return NextResponse.json(
        { error: 'Only resolved conversations can be reopened' },
        { status: 409 },
      );
    }

    const updateResult = await insforge.database.from('conversations')
      .update({ status: 'open', ai_state: 'idle', updated_at: new Date().toISOString() })
      .eq('id', conversationId);
    assertInsforgeSuccess(updateResult, 'reopen-conversation failed to update conversation');

    let auditWarning: string | null = null;
    try {
      const auditResult = await insforge.database.from('audit_logs').insert([{
        organization_id: conversation.organization_id,
        actor_id: user.id,
        actor_type: 'user',
        action: 'conversation_reopened',
        resource_type: 'conversation',
        resource_id: conversationId,
        metadata: {},
      }]);
      if (auditResult.error) {
        auditWarning = `Conversation was reopened, but its audit log failed: ${auditResult.error.message}`;
        console.error('reopen-conversation: failed to write audit log', auditResult.error.message);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      auditWarning = `Conversation was reopened, but its audit log failed: ${detail}`;
      console.error('reopen-conversation: failed to write audit log', detail);
    }

    try {
      await publishRealtimeMessage(
        `org:${conversation.organization_id as string}`,
        'conversation_updated',
        { conversationId, status: 'open', aiState: 'idle' },
      );
    } catch (error) {
      console.warn(
        'reopen-conversation: failed to publish realtime update',
        error instanceof Error ? error.message : String(error),
      );
    }

    return NextResponse.json(
      auditWarning
        ? { status: 'accepted', warning: auditWarning }
        : { status: 'ok' },
    );
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal server error' }, { status: 500 });
  }
}
