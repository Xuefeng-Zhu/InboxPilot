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
      .select('organization_id')
      .eq('id', conversationId)
      .limit(1);
    assertInsforgeSuccess(conversationResult, 'resolve-conversation failed to load conversation');
    const { data: convo } = conversationResult;
    const conversation = Array.isArray(convo) ? convo[0] : convo;
    if (!conversation) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });

    const allowed = await userHasOrgPermission(
      user.id,
      conversation.organization_id as string,
      'reply_conversations',
    );
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const updateResult = await insforge.database.from('conversations')
      .update({ status: 'resolved', ai_state: 'idle', updated_at: new Date().toISOString() })
      .eq('id', conversationId);
    assertInsforgeSuccess(updateResult, 'resolve-conversation failed to update conversation');

    try {
      await publishRealtimeMessage(
        `org:${conversation.organization_id as string}`,
        'conversation_updated',
        { conversationId, status: 'resolved', aiState: 'idle' },
      );
    } catch (error) {
      console.warn(
        'resolve-conversation: failed to publish realtime update',
        error instanceof Error ? error.message : String(error),
      );
    }

    return NextResponse.json({ status: 'ok' });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal server error' }, { status: 500 });
  }
}
