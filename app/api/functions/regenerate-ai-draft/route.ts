import { NextRequest, NextResponse } from 'next/server';
import { insforgeAdmin as insforge } from '@/lib/insforge-admin';
import { getUserFromToken } from '../_auth';

const FUNCTIONS_URL = process.env.NEXT_PUBLIC_INSFORGE_FUNCTIONS_URL!;
const SERVICE_KEY = process.env.INSFORGE_SERVICE_ROLE_KEY!;

export async function POST(req: NextRequest) {
  try {
    const user = getUserFromToken(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { conversationId } = await req.json();
    if (!conversationId) return NextResponse.json({ error: 'Missing conversationId' }, { status: 400 });

    const { data: convo } = await insforge.database
      .from('conversations').select('organization_id').eq('id', conversationId).limit(1);
    const conversation = Array.isArray(convo) ? convo[0] : convo;
    if (!conversation) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });

    await insforge.database.from('conversations').update({ ai_state: 'thinking' }).eq('id', conversationId);

    await insforge.database.from('support_jobs').insert([{
      organization_id: conversation.organization_id,
      job_type: 'process_ai_message',
      payload: { conversationId },
      status: 'pending',
      attempts: 0,
      max_attempts: 5,
      run_after: new Date().toISOString(),
    }]);

    // Trigger process-jobs server-side
    fetch(`${FUNCTIONS_URL}/process-jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      body: '{}',
    }).catch(() => {});

    return NextResponse.json({ status: 'ok' });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal server error' }, { status: 500 });
  }
}
