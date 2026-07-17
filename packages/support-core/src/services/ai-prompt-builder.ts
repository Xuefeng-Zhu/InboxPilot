import type { ChatMessage, Message } from '../types/index.js';

/** Build the grounded JSON-response prompt for one AI support turn. */
export function buildAiPrompt(
  messages: Message[],
  knowledgeChunks: ReadonlyArray<{ content: string }>,
  systemPrompt: string | null,
): ChatMessage[] {
  const baseSystemPrompt = systemPrompt ??
    'You are a helpful customer support AI assistant. Analyze the conversation and provide a structured response.';

  let fullSystemPrompt = baseSystemPrompt;
  if (knowledgeChunks.length > 0) {
    const knowledgeContext = knowledgeChunks
      .map((chunk, index) => `[Knowledge ${index + 1}]: ${chunk.content}`)
      .join('\n\n');
    fullSystemPrompt += `\n\nRelevant knowledge base articles:\n${knowledgeContext}`;
  } else {
    fullSystemPrompt += `\n\nNo relevant knowledge base article was found for this message. Do not invent facts, policies, prices, timelines, or account-specific details. If you cannot answer safely from the conversation alone, return decision_type "clarify", requires_human false, and a concise response_text that asks the customer for the missing detail or explains that you need more information. Do not escalate solely because knowledge is missing.`;
  }

  fullSystemPrompt += `\n\nYou MUST respond with a JSON object in this exact format:
{
  "decision_type": "respond" | "escalate" | "clarify",
  "confidence": 0.0 to 1.0,
  "reasoning_summary": "brief explanation of your reasoning",
  "response_text": "your response to the customer" or null,
  "tags": ["relevant", "tags"],
  "requires_human": true or false
}`;

  return [
    { role: 'system', content: fullSystemPrompt },
    ...messages.map((message): ChatMessage => ({
      role: message.senderType === 'contact' ? 'user' : 'assistant',
      content: message.body,
    })),
  ];
}
