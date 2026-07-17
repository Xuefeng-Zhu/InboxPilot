import { describe, expect, it } from 'vitest';
import { buildAiPrompt } from '../../src/services/ai-prompt-builder.js';
import type { Message } from '../../src/types/index.js';

function message(senderType: Message['senderType'], body: string): Message {
  return {
    id: `${senderType}-${body}`,
    conversationId: 'conversation-1',
    senderType,
    senderId: null,
    direction: senderType === 'contact' ? 'inbound' : 'outbound',
    channel: 'webchat',
    body,
    subject: null,
    rawPayload: {},
    provider: 'webchat',
    providerAccountId: null,
    externalMessageId: `${senderType}-${body}`,
    deliveryStatus: 'delivered',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };
}

describe('buildAiPrompt', () => {
  it('adds numbered knowledge and preserves conversation roles', () => {
    const prompt = buildAiPrompt(
      [message('contact', 'Where is my order?'), message('user', 'Let me check.')],
      [{ content: 'Orders arrive in three days.' }],
      'Be concise.',
    );

    expect(prompt[0].content).toContain('[Knowledge 1]: Orders arrive in three days.');
    expect(prompt.slice(1)).toEqual([
      { role: 'user', content: 'Where is my order?' },
      { role: 'assistant', content: 'Let me check.' },
    ]);
  });

  it('adds the anti-hallucination clarification policy when knowledge is empty', () => {
    const prompt = buildAiPrompt([], [], null);

    expect(prompt[0].content).toContain('Do not invent facts');
    expect(prompt[0].content).toContain('decision_type "clarify"');
  });
});
