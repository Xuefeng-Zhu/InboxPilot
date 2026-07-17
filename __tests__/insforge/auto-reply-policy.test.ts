import { describe, expect, it } from 'vitest';
import { shouldAutoSendDecision } from '../../insforge/functions/_shared/auto-reply-policy';

describe('shouldAutoSendDecision', () => {
  it('sends only a response with an immutable auto-send directive', () => {
    expect(shouldAutoSendDecision({
      responseText: 'Send me',
      rawResponse: { _shouldAutoSend: true },
    })).toBe(true);
  });

  it('does not send a recovered draft when unrelated conversation state changes', () => {
    expect(shouldAutoSendDecision({
      responseText: 'Keep as draft',
      rawResponse: { _shouldAutoSend: false },
    })).toBe(false);
    expect(shouldAutoSendDecision({
      responseText: 'Legacy draft',
      rawResponse: null,
    })).toBe(false);
  });
});
