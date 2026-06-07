/**
 * LLM-as-judge — grades a response text against a rubric using a separate
 * (typically stronger) model.
 *
 * The judge model receives:
 *   - the original contact message
 *   - the AI's response text
 *   - the rubric (list of criteria)
 *
 * and returns a JSON object:
 *   {
 *     "scores": [{ "id": "<criterion id>", "score": 0.0..1.0, "note": "<short reason>" }, ...]
 *   }
 *
 * In CI we use a deterministic mock judge (no network) that applies a
 * simple keyword/heuristic rubric grader. For live runs, the harness
 * optionally uses a real judge model — see `LiveRubricJudge`.
 */

import type { Rubric } from '../../packages/support-core/__tests__/golden/types.js';

export interface JudgeScore {
  id: string;
  score: number;
  note: string;
}

export interface JudgeResult {
  scores: JudgeScore[];
  raw?: string;
}

export interface RubricJudge {
  judge(params: {
    contactMessage: string;
    responseText: string;
    rubric: Rubric;
  }): Promise<JudgeResult>;
}

// ─── Heuristic / deterministic judge (CI default) ──────────────────

/**
 * A deterministic, no-network judge that applies simple heuristics:
 *   - "binary" criteria with the word "no-X" → fail if X is present
 *   - "binary" criteria with "mentions X" → pass if X (or a synonym) appears
 *   - "binary" criteria with "asks X" → pass if response is a question that touches X
 *   - "threshold" criteria → score 0..1 based on heuristics
 *
 * It is intentionally simple — its job is to be REPRODUCIBLE. The real
 * value comes from running the harness against two different AI models
 * and seeing the same judge pick the same winner. For nuanced grading
 * the harness can be pointed at a live model via the LiveRubricJudge.
 */
export class HeuristicRubricJudge implements RubricJudge {
  async judge(params: {
    contactMessage: string;
    responseText: string;
    rubric: Rubric;
  }): Promise<JudgeResult> {
    const text = params.responseText ?? '';
    const lower = text.toLowerCase();
    const scores: JudgeScore[] = [];

    for (const c of params.rubric.criteria) {
      const desc = c.description.toLowerCase();
      let score = 0;
      let note = '';

      // Special-case: "no-llm-call" / "no-X" style — pass if response is empty
      if (desc.includes('no llm was called') || desc.includes('no-llm-call')) {
        score = text === '' ? 1 : 0.0;
        note = text === '' ? 'Response is empty as expected (no LLM call).' : 'Response is non-empty; LLM was apparently called.';
      }
      // "no-emoji" — pass if no emoji
      else if (desc.includes('no emoji') || desc.includes('no-emoji')) {
        const hasEmoji = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F100}-\u{1F1FF}]/u.test(text);
        score = hasEmoji ? 0 : 1;
        note = hasEmoji ? 'Response contains emoji.' : 'Response has no emoji.';
      }
      // "mentions X" — look for key nouns in the description
      else if (desc.startsWith('reply mentions')) {
        const m = /reply mentions?\s+(.+?)\.?\s*$/i.exec(params.rubric.criteria.find((x) => x.id === c.id)?.description ?? '');
        const target = m ? m[1].toLowerCase() : '';
        const present = target && lower.includes(target);
        score = present ? 1 : 0;
        note = present ? `Mentions "${target}".` : `Does not mention "${target}".`;
      }
      // "tells the customer to do X"
      else if (desc.startsWith('reply tells')) {
        const m = /reply tells the customer to\s+(.+?)\.?\s*$/i.exec(c.description);
        const target = m ? m[1].toLowerCase() : '';
        const present = target && lower.includes(target);
        score = present ? 1 : 0;
        note = present ? `Tells customer to ${target}.` : `Does not say to ${target}.`;
      }
      // "asks for X"
      else if (desc.startsWith('reply asks')) {
        const isQuestion = text.includes('?');
        const m = /reply asks (?:the customer )?(?:for |to )?(.+?)\.?\s*$/i.exec(c.description);
        const target = m ? m[1].toLowerCase() : '';
        const present = isQuestion && (!target || lower.includes(target.split(' ')[0]));
        score = present ? 1 : 0;
        note = present ? 'Reply asks a relevant question.' : 'Reply does not ask the expected question.';
      }
      // "uses X" / "acknowledges X"
      else if (desc.startsWith('reply uses') || desc.startsWith('reply acknowledges')) {
        const m = /(?:uses|acknowledges)\s+(?:the\s+)?(.+?)\.?\s*$/i.exec(c.description);
        const target = m ? m[1].toLowerCase() : '';
        const present = target && (lower.includes(target) || lower.includes(target.split(' ')[0]));
        score = present ? 1 : 0;
        note = present ? 'Acknowledged/used the target.' : 'Did not acknowledge/use the target.';
      }
      // "greeting"
      else if (desc.includes('greets back') || desc.includes('greeting')) {
        const greetingWords = ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening'];
        const has = greetingWords.some((g) => lower.includes(g));
        score = has ? 1 : 0;
        note = has ? 'Greets the customer.' : 'No greeting detected.';
      }
      // "asks how it can help"
      else if (desc.includes('asks how it can help')) {
        const has = lower.includes('how can i help') || lower.includes('how can we help') || lower.includes('anything i can help');
        score = has ? 1 : 0;
        note = has ? 'Asks how to help.' : 'Does not ask how to help.';
      }
      // "is concise (under N chars)"
      else if (desc.includes('concise') || desc.includes('under ')) {
        const m = /under\s+(\d+)/i.exec(c.description);
        const limit = m ? parseInt(m[1], 10) : 200;
        score = text.length > 0 && text.length <= limit ? 1 : 0;
        note = `Length ${text.length} chars (limit ${limit}).`;
      }
      // "length 30-300"
      else if (desc.includes('length')) {
        const m = /length.*?(\d+).*?(\d+)/i.exec(c.description);
        if (m) {
          const lo = parseInt(m[1], 10);
          const hi = parseInt(m[2], 10);
          if (text.length >= lo && text.length <= hi) score = 1;
          else if (text.length === 0) score = 0;
          else if (text.length < lo) score = 0.5;
          else score = 0.3;
          note = `Length ${text.length} chars (target ${lo}-${hi}).`;
        } else {
          score = text.length > 0 ? 1 : 0;
          note = `Length ${text.length} chars.`;
        }
      }
      // "no auto-reply"
      else if (desc.includes('does not auto-reply') || desc.includes('no-auto-reply')) {
        score = text === '' || text == null ? 1 : 0.5;
        note = text === '' || text == null ? 'No response (escalated).' : 'Response text present.';
      }
      // "no X" generic
      else if (desc.startsWith('reply does not') || desc.includes('does not')) {
        // "reply does not attempt to answer X" — check for the forbidden content
        const m = /does not (.+?)\.?\s*$/i.exec(c.description);
        const forbidden = m ? m[1].toLowerCase() : '';
        if (forbidden && forbidden.length > 3) {
          // Heuristic: if response has a question mark and is on-topic
          // (e.g. redirects), it passes.
          score = lower.includes('help') || lower.includes('support') ? 1 : 0;
          note = 'Redirects to support.';
        } else {
          score = text.length > 0 ? 1 : 0;
          note = 'Generic check.';
        }
      }
      // "redirects to X"
      else if (desc.includes('redirects')) {
        const has = lower.includes('help') || lower.includes('support') || lower.includes('order') || lower.includes('account');
        score = has ? 1 : 0;
        note = has ? 'Redirects appropriately.' : 'Does not redirect.';
      }
      // "stays on-topic"
      else if (desc.includes('stays on-topic')) {
        const onTopic = lower.includes('help') || lower.includes('support') || lower.includes('order') || lower.includes('question') || lower.includes('account');
        score = onTopic ? 1 : 0;
        note = onTopic ? 'Stays on support topics.' : 'Strays off-topic.';
      }
      // "tone is professional" / "professional"
      else if (desc.includes('professional') || desc.includes('friendly')) {
        // Pass if not empty and no emoji
        const hasEmoji = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}]/u.test(text);
        const hasGreeting = /hello|hi\b|hey|good (morning|afternoon|evening)|dear/i.test(text);
        const hasSignOff = /regards|thank you|thanks|sincerely|best,/i.test(text);
        let s = 0.5;
        if (!hasEmoji) s += 0.2;
        if (hasGreeting) s += 0.15;
        if (hasSignOff) s += 0.15;
        score = Math.min(1, s);
        note = `Professional tone signals: greeting=${hasGreeting} signoff=${hasSignOff} no-emoji=${!hasEmoji}`;
      }
      // "tags include X" — checks the decision tag list, not response text.
      // The harness uses a parallel check on the actual decision tags.
      // Here we return 0; the harness's tag check will score these.
      else if (desc.includes('tags include')) {
        score = 0;
        note = 'Tag check handled by harness (not judge).';
      }
      // "decision reasoning mentions X"
      else if (desc.includes('reasoning mentions') || desc.includes('reasoning summary')) {
        const m = /mentions?\s+(.+?)\.?\s*$/i.exec(c.description);
        const target = m ? m[1].toLowerCase() : '';
        // The judge doesn't have access to the reasoning; this is a stub.
        score = 0;
        note = `Reasoning check requires decision.reasoningSummary (target: "${target}").`;
      }
      // "decision tags include" — stub, harness handles
      else if (desc.includes('decision is marked') || desc.includes('decision has')) {
        score = 0;
        note = 'Decision shape check handled by harness.';
      }
      // Fallback
      else {
        score = text.length > 0 ? 0.5 : 0;
        note = `Heuristic judge could not interpret: "${c.description}". Defaulted to 0.5.`;
      }

      scores.push({ id: c.id, score, note });
    }

    return { scores, raw: 'heuristic' };
  }
}

// ─── Live judge (uses an LLM to grade) ────────────────────────────

/**
 * Live rubric judge. Calls the same OpenRouter-compatible client the
 * eval target uses (or a different "judge" model). The judge receives
 * the rubric and produces structured JSON scores.
 *
 * In CI this is unused (heuristic judge is the default). To run with a
 * live judge: --judge-model anthropic/claude-3-5-sonnet
 */
export class LiveRubricJudge implements RubricJudge {
  constructor(
    private readonly callLlm: (params: {
      model: string;
      messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
      responseFormat: { type: 'json_object' };
    }) => Promise<string>,
    private readonly judgeModel: string = 'anthropic/claude-3-5-sonnet',
  ) {}

  async judge(params: {
    contactMessage: string;
    responseText: string;
    rubric: Rubric;
  }): Promise<JudgeResult> {
    const systemPrompt = `You are a strict rubric grader. You will receive:
- A contact message (the customer's question).
- An AI's response text (may be empty if the AI was escalated).
- A rubric (list of criteria).

For each criterion, return a score 0.0..1.0 and a one-sentence note.
You MUST respond with JSON in the shape:
{
  "scores": [ { "id": "<criterion id>", "score": 0.0, "note": "..." } ]
}
Only return the JSON object, no prose.`;

    const userPrompt = JSON.stringify(
      {
        contact_message: params.contactMessage,
        response_text: params.responseText,
        rubric: params.rubric,
      },
      null,
      2,
    );

    const raw = await this.callLlm({
      model: this.judgeModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      responseFormat: { type: 'json_object' },
    });

    try {
      const parsed = JSON.parse(raw) as { scores: JudgeScore[] };
      return { scores: parsed.scores, raw };
    } catch {
      return {
        scores: params.rubric.criteria.map((c) => ({
          id: c.id,
          score: 0,
          note: `Live judge returned invalid JSON: ${raw.slice(0, 200)}`,
        })),
        raw,
      };
    }
  }
}
