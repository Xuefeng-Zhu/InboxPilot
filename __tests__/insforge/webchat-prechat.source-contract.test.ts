import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sessionInfoSource = readFileSync(
  new URL(
    '../../insforge/functions/webchat-session-info/index.ts',
    import.meta.url,
  ),
  'utf8',
);
const threadInitSource = readFileSync(
  new URL(
    '../../insforge/functions/webchat-thread-init/index.ts',
    import.meta.url,
  ),
  'utf8',
);
const inboundSource = readFileSync(
  new URL(
    '../../insforge/functions/webchat-inbound/index.ts',
    import.meta.url,
  ),
  'utf8',
);
const threadRepositorySource = readFileSync(
  new URL(
    '../../packages/support-core/src/repositories/webchat-thread-repository.ts',
    import.meta.url,
  ),
  'utf8',
);

describe('webchat pre-chat source contracts', () => {
  it('derives pre-chat requirements from widget configuration and identification', () => {
    expect(sessionInfoSource).toContain('const { claims, thread, widget } = verified');
    expect(sessionInfoSource).toContain(
      'requiresPreChat: widget.preChatEnabled && !thread.identifiedAt',
    );
    expect(threadInitSource).toContain(
      'requiresPreChat: widget.preChatEnabled && !result.thread.identifiedAt',
    );
  });

  it('blocks direct inbound calls before rate limiting or message side effects', () => {
    const guardIndex = inboundSource.indexOf(
      'widget.preChatEnabled && !thread.identifiedAt',
    );
    const rateLimitIndex = inboundSource.indexOf(
      'checkRateLimit(claims.threadId)',
    );

    expect(guardIndex).toBeGreaterThan(-1);
    expect(rateLimitIndex).toBeGreaterThan(guardIndex);
    expect(inboundSource).toContain(
      "return jsonResponse({ error: 'Complete pre-chat identification before sending a message' }, 403)",
    );
  });

  it('persists identification supplied during thread initialization', () => {
    expect(threadRepositorySource).toContain(
      'row.identified_at = input.identifiedAt',
    );
  });
});
