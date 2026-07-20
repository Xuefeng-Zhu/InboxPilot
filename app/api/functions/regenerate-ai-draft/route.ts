import { NextRequest, NextResponse } from 'next/server';
import { insforgeAdmin as insforge } from '@/lib/insforge-admin';
import { getUserFromToken, userHasOrgPermission } from '../_auth';
import { assertInsforgeSuccess } from '@/lib/insforge-result';

const PROCESS_JOBS_TRIGGER_TIMEOUT_MS = 1_500;

function rpcReturnedTrue(data: unknown): boolean {
  return data === true || (Array.isArray(data) && data[0] === true);
}

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
      .from('conversations')
      .select('organization_id,status,ai_state,latest_message_id,pending_ai_decision_id')
      .eq('id', conversationId)
      .limit(1);
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

    if (
      conversation.status !== 'open' ||
      conversation.ai_state !== 'drafted' ||
      typeof conversation.latest_message_id !== 'string' ||
      typeof conversation.pending_ai_decision_id !== 'string'
    ) {
      return NextResponse.json(
        { error: 'Draft is already being processed or is no longer pending' },
        { status: 409 },
      );
    }

    // Claim the exact pending decision and enqueue its source-bound job in one
    // database transaction. Approval and regeneration race on the same row;
    // the loser returns a conflict without leaving runnable work behind.
    const enqueueResult = await insforge.database.rpc('enqueue_regenerate_ai_draft', {
      p_conversation_id: conversationId,
      p_organization_id: conversation.organization_id,
      p_source_message_id: conversation.latest_message_id,
      p_pending_ai_decision_id: conversation.pending_ai_decision_id,
    });
    assertInsforgeSuccess(enqueueResult, 'regenerate-ai-draft failed to enqueue job');
    if (!rpcReturnedTrue(enqueueResult.data)) {
      return NextResponse.json(
        { error: 'Draft is already being processed or is no longer pending' },
        { status: 409 },
      );
    }

    // Trigger process-jobs server-side. The job is already durable, so trigger
    // failures are logged and left for the scheduler to pick up.
    await triggerProcessJobs();

    return NextResponse.json({
      status: 'queued',
    }, { status: 202 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal server error' }, { status: 500 });
  }
}
