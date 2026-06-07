import { NextRequest, NextResponse } from 'next/server';
import { insforgeAdmin as insforge } from '@/lib/insforge-admin';
import { getUserFromToken } from '../_auth';

export async function POST(req: NextRequest) {
  try {
    const user = getUserFromToken(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { conversationId, aiDecisionId } = await req.json();
    if (!conversationId || !aiDecisionId) {
      return NextResponse.json({ error: 'Missing conversationId or aiDecisionId' }, { status: 400 });
    }

    // Load AI decision
    const { data: decisions } = await insforge.database
      .from('ai_decisions')
      .select('*')
      .eq('conversation_id', conversationId)
      .eq('id', aiDecisionId)
      .order('created_at', { ascending: false })
      .limit(1);

    const decision = Array.isArray(decisions) ? decisions[0] : decisions;
    if (!decision || !decision.response_text) {
      return NextResponse.json({ error: 'AI decision not found or has no response' }, { status: 404 });
    }

    // Load conversation
    const { data: convo } = await insforge.database
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .limit(1);

    const conversation = Array.isArray(convo) ? convo[0] : convo;
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // Create outbound message (mock send — same as what the edge function did)
    const { data: msg, error: msgErr } = await insforge.database
      .from('messages')
      .insert([{
        conversation_id: conversationId,
        sender_type: 'ai',
        sender_id: user.id,
        direction: 'outbound',
        channel: conversation.channel,
        body: decision.response_text,
        provider: 'mock',
        external_message_id: `approved_${Date.now()}`,
        delivery_status: 'queued',
      }])
      .select('*');

    if (msgErr) {
      return NextResponse.json({ error: msgErr.message }, { status: 500 });
    }

    const message = Array.isArray(msg) ? msg[0] : msg;

    // Update conversation
    await insforge.database
      .from('conversations')
      .update({ ai_state: 'idle', last_message_at: new Date().toISOString() })
      .eq('id', conversationId);

    // Audit log
    await insforge.database
      .from('audit_logs')
      .insert([{
        organization_id: conversation.organization_id,
        actor_id: user.id,
        actor_type: 'user',
        action: 'ai_draft_approved',
        resource_type: 'ai_decision',
        resource_id: aiDecisionId,
        metadata: { conversationId, messageId: message?.id },
      }]);

    return NextResponse.json({ status: 'ok', data: { message } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
