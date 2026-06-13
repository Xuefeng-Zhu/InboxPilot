import { NextRequest, NextResponse } from 'next/server';
import { insforgeAdmin as insforge } from '@/lib/insforge-admin';
import { getUserFromToken, userHasOrgPermission } from '../_auth';

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromToken(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { conversationId, body } = await req.json();
    if (!conversationId || !body) {
      return NextResponse.json({ error: 'Missing conversationId or body' }, { status: 400 });
    }

    const { data: convo } = await insforge.database
      .from('conversations').select('*').eq('id', conversationId).limit(1);
    const conversation = Array.isArray(convo) ? convo[0] : convo;
    if (!conversation) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });

    const allowed = await userHasOrgPermission(
      user.id,
      conversation.organization_id as string,
      'reply_conversations',
    );
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { data: msg, error: msgErr } = await insforge.database
      .from('messages')
      .insert([{
        conversation_id: conversationId,
        sender_type: 'user',
        sender_id: user.id,
        direction: 'outbound',
        channel: conversation.channel,
        body,
        provider: conversation.channel === 'webchat' ? 'webchat' : 'mock',
        external_message_id: `reply_${Date.now()}`,
        delivery_status: conversation.channel === 'webchat' ? 'sent' : 'queued',
      }])
      .select('*');

    if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 });

    await insforge.database.from('conversations')
      .update({ last_message_at: new Date().toISOString() }).eq('id', conversationId);

    const message = Array.isArray(msg) ? msg[0] : msg;

    // For webchat: publish to the visitor's realtime channel
    if (conversation.channel === 'webchat') {
      const { data: threadData } = await insforge.database
        .from('webchat_threads')
        .select('widget_id,visitor_token_jti')
        .eq('conversation_id', conversationId)
        .limit(1);

      const thread = Array.isArray(threadData) ? threadData[0] : threadData;
      if (thread) {
        const baseUrl = process.env.NEXT_PUBLIC_INSFORGE_URL ?? '';
        const serviceRoleKey = process.env.INSFORGE_SERVICE_ROLE_KEY ?? '';

        // Fire-and-forget realtime publish
        fetch(`${baseUrl}/realtime/v1/api/broadcast`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({
            channel: `widget:${thread.widget_id}:${thread.visitor_token_jti}`,
            event: 'new_message',
            payload: { message, conversationId },
          }),
        }).catch(() => { /* non-critical */ });
      }
    }

    return NextResponse.json({ status: 'ok', data: message });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal server error' }, { status: 500 });
  }
}
