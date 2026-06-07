import { NextRequest, NextResponse } from 'next/server';
import { insforgeAdmin as insforge } from '@/lib/insforge-admin';
import { getUserFromToken } from '../_auth';

export async function POST(req: NextRequest) {
  try {
    const user = getUserFromToken(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { conversationId, body } = await req.json();
    if (!conversationId || !body) {
      return NextResponse.json({ error: 'Missing conversationId or body' }, { status: 400 });
    }

    const { data: convo } = await insforge.database
      .from('conversations').select('*').eq('id', conversationId).limit(1);
    const conversation = Array.isArray(convo) ? convo[0] : convo;
    if (!conversation) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });

    const { data: msg, error: msgErr } = await insforge.database
      .from('messages')
      .insert([{
        conversation_id: conversationId,
        sender_type: 'user',
        sender_id: user.id,
        direction: 'outbound',
        channel: conversation.channel,
        body,
        provider: 'mock',
        external_message_id: `reply_${Date.now()}`,
        delivery_status: 'queued',
      }])
      .select('*');

    if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 });

    await insforge.database.from('conversations')
      .update({ last_message_at: new Date().toISOString() }).eq('id', conversationId);

    const message = Array.isArray(msg) ? msg[0] : msg;
    return NextResponse.json({ status: 'ok', data: message });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal server error' }, { status: 500 });
  }
}
