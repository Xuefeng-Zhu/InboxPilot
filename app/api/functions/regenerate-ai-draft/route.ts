import { NextRequest, NextResponse } from 'next/server';
import { insforgeAdmin as insforge } from '@/lib/insforge-admin';
import { getUserFromToken, userHasOrgPermission } from '../_auth';
import { assertInsforgeSuccess } from '@/lib/insforge-result';

const PROCESS_JOBS_TRIGGER_TIMEOUT_MS = 1_500;

async function triggerProcessJobs(): Promise<void> {
  const functionsUrl = process.env.NEXT_PUBLIC_INSFORGE_FUNCTIONS_URL;
  const processJobsSecret = process.env.PROCESS_JOBS_SECRET;
  if (!functionsUrl || !processJobsSecret) {
    console.warn(
      `regenerate-ai-draft: missing ${!functionsUrl ? 'NEXT_PUBLIC_INSFORGE_FUNCTIONS_URL' : 'PROCESS_JOBS_SECRET'}; job remains queued`,
    );
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    PROCESS_JOBS_TRIGGER_TIMEOUT_MS,
  );
  try {
    const res = await fetch(`${functionsUrl}/process-jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Process-Jobs-Secret': processJobsSecret,
      },
      body: '{}',
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`regenerate-ai-draft: process-jobs trigger failed with HTTP ${res.status}`);
    }
  } catch (err) {
    const detail = err instanceof Error && err.name === 'AbortError'
      ? `timed out after ${PROCESS_JOBS_TRIGGER_TIMEOUT_MS}ms`
      : err instanceof Error
        ? err.message
        : String(err);
    console.warn(
      'regenerate-ai-draft: process-jobs trigger failed',
      detail,
    );
  } finally {
    clearTimeout(timeout);
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

    // The job is the durable source of truth. The worker transitions ai_state
    // to `thinking` when processing begins; updating state before this insert
    // could otherwise strand the conversation if enqueueing failed.
    const enqueueResult = await insforge.database.from('support_jobs').insert([{
      organization_id: conversation.organization_id,
      job_type: 'process_ai_message',
      payload: { conversationId },
      idempotency_key: JSON.stringify([
        ['conversationId', conversationId],
        ['operation', 'regenerate_ai_draft'],
      ]),
      status: 'pending',
      attempts: 0,
      max_attempts: 5,
      run_after: new Date().toISOString(),
    }]);
    if (enqueueResult.error?.code !== '23505') {
      assertInsforgeSuccess(enqueueResult, 'regenerate-ai-draft failed to enqueue job');
    }

    // The durable job now exists, so it is safe to expose the thinking state.
    // A state-write failure must not turn the accepted job into a retryable
    // client error; the worker performs the same transition when it claims it.
    let stateWarning: string | null = null;
    try {
      const stateResult = await insforge.database
        .from('conversations')
        .update({ ai_state: 'thinking' })
        .eq('id', conversationId);
      if (stateResult.error) {
        stateWarning = `Draft regeneration was queued, but the thinking state could not be updated: ${stateResult.error.message}`;
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      stateWarning = `Draft regeneration was queued, but the thinking state could not be updated: ${detail}`;
    }
    if (stateWarning) console.warn('regenerate-ai-draft:', stateWarning);

    // Trigger process-jobs server-side. The job is already durable, so trigger
    // failures are logged and left for the scheduler to pick up.
    await triggerProcessJobs();

    return NextResponse.json({
      status: 'queued',
      ...(stateWarning ? { warning: stateWarning } : {}),
    }, { status: 202 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal server error' }, { status: 500 });
  }
}
