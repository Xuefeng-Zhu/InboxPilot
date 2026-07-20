import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../../insforge/functions/process-jobs/index.ts', import.meta.url),
  'utf8',
);
const autoReplySource = readFileSync(
  new URL('../../insforge/functions/_shared/auto-reply-sender.ts', import.meta.url),
  'utf8',
);

// These checks supplement the executable run-claimed-job, auto-reply-policy,
// and auto-reply-recovery suites by pinning Deno entrypoint wiring that is not
// imported into the browser-oriented Vitest runtime.
describe('process-jobs source wiring contracts', () => {
  it('delegates auto-reply delivery to the focused shared sender', () => {
    expect(source).toContain('createAutoReplySender({');
    expect(source).not.toContain('async function sendAutoReply');
  });

  it('persists AI sender identity through OutboundMessageService in one write', () => {
    expect(autoReplySource).toContain("{ type: 'ai', id: null }");
    expect(autoReplySource).not.toContain("update({ sender_type: 'ai', sender_id: null })");
  });

  it('does not retry an auto-reply after the provider accepted it', () => {
    expect(autoReplySource).toContain('error instanceof OutboundMessagePostDispatchError');
    expect(autoReplySource).toContain('suppressing automatic retry');
  });

  it('does not broadcast ready for superseded knowledge work', () => {
    expect(source).toContain("if (outcome === 'superseded') return");
  });

  it('binds AI work and auto-send eligibility to the immutable source message', () => {
    expect(source).toContain('const sourceMessageId =');
    expect(source).toContain('{ sourceJobId: job.id, sourceMessageId }');
    expect(source).toContain('if (!decision) return');
    expect(source).toContain('successful final source CAS is the reply-intent ordering point');
    expect(source).not.toContain('latestMessage?.id !== sourceMessageId');
    expect(source).toContain('sourceMessageId,');
    expect(source).toContain('dispatchQueuedAutoReply({');
    expect(source).toContain('conversationRepo.transitionAiSourceTurn(');
    expect(source).toContain("{ aiState: 'auto_replied', status: 'open' }");
  });

  it('fails unsupported delivery-status retry jobs instead of completing them as no-ops', () => {
    expect(source).toContain("throw new Error('process_delivery_status retry handler is not implemented')");
  });

  it('fails retry_failed_jobs instead of completing it as a no-op', () => {
    expect(source).toContain("throw new Error('retry_failed_jobs handler is not implemented')");
  });
});
