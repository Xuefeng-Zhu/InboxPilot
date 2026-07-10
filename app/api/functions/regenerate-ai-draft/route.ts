import { NextRequest, NextResponse } from 'next/server';
import { insforgeAdmin as insforge } from '@/lib/insforge-admin';
import { getUserFromToken, userHasOrgPermission } from '../_auth';
import { assertInsforgeSuccess } from '@/lib/insforge-result';

async function triggerProcessJobs(): Promise<void> {
  const functionsUrl = process.env.NEXT_PUBLIC_INSFORGE_FUNCTIONS_URL;
  const serviceKey = process.env.INSFORGE_SERVICE_ROLE_KEY;
  if (!functionsUrl || !serviceKey) {
    console.warn(
      `regenerate-ai-draft: missing ${!functionsUrl ? 'NEXT_PUBLIC_INSFORGE_FUNCTIONS_URL' : 'INSFORGE_SERVICE_ROLE_KEY'}; job remains queued`,
    );
    return;
  }

  try {
    const res = await fetch(`${functionsUrl}/process-jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: '{}',
    });
    if (!res.ok) {
      console.warn(`regenerate-ai-draft: process-jobs trigger failed with HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn(
      'regenerate-ai-draft: process-jobs trigger failed',
      err instanceof Error ? err.message : String(err),
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromToken(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { conversationId } = await req.json();
    if (!conversationId) return NextResponse.json({ error: 'Missing conversationId' }, { status: 400 });

    const conversationResult = await insforge.database
      .from('conversations').select('organization_id').eq('id', conversationId).limit(1);
    assertInsforgeSuccess(
      conversationResult,
      'regenerate-ai-draft failed to load conversation',
    );
    const { data: convo } = conversationResult;
    const conversation = Array.isArray(convo) ? convo[0] : convo;
    if (!conversation) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });

    const allowed = await userHasOrgPermission(
      user.id,
      conversation.organization_id as string,
      'reply_conversations',
    );
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const stateResult = await insforge.database
      .from('conversations')
      .update({ ai_state: 'thinking' })
      .eq('id', conversationId);
    assertInsforgeSuccess(stateResult, 'regenerate-ai-draft failed to update conversation');

    const enqueueResult = await insforge.database.from('support_jobs').insert([{
      organization_id: conversation.organization_id,
      job_type: 'process_ai_message',
      payload: { conversationId },
      status: 'pending',
      attempts: 0,
      max_attempts: 5,
      run_after: new Date().toISOString(),
    }]);
    assertInsforgeSuccess(enqueueResult, 'regenerate-ai-draft failed to enqueue job');

    // Trigger process-jobs server-side. The job is already durable, so trigger
    // failures are logged and left for the scheduler to pick up.
    await triggerProcessJobs();

    return NextResponse.json({ status: 'ok' });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal server error' }, { status: 500 });
  }
}
