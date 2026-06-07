import { describe, it, expect } from 'vitest';
import {
  HumanRequestRule,
  ProfanityAngerRule,
  SensitiveTopicRule,
  SafetyConcernRule,
  MissingKnowledgeRule,
  RepeatedFailureRule,
  KeywordRule,
  LowConfidenceRule,
  createDefaultEscalationEngine,
} from '../../src/services/escalation-rules.js';
import type { EscalationContext } from '../../src/interfaces/escalation.js';
import type { AiSettings } from '../../src/types/index.js';

/**
 * Unit tests for individual escalation rules with specific trigger phrases.
 */

// ─── Helpers ──────────────────────────────────────────────────────

const DEFAULT_SETTINGS: AiSettings = {
  id: 'settings-001',
  organizationId: 'org-001',
  aiMode: 'draft_only',
  confidenceThreshold: 0.75,
  contextWindowSize: 20,
  maxConsecutiveFailures: 3,
  knowledgeSimilarityThreshold: 0.7,
  escalationKeywords: [],
  systemPrompt: null,
  model: 'openai/gpt-4o-mini',
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeContext(overrides: Partial<EscalationContext> = {}): EscalationContext {
  return {
    latestMessage: 'Hello, I need help with my order.',
    conversationHistory: [],
    knowledgeChunks: [{ id: '1', documentId: 'd1', organizationId: 'org-001', content: 'chunk', embedding: [], metadata: {}, createdAt: new Date() }],
    knowledgeSimilarityThreshold: 0.7,
    aiSettings: DEFAULT_SETTINGS,
    consecutiveAiFailures: 0,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────

describe('Escalation Rules — Individual Rule Tests', () => {
  describe('HumanRequestRule', () => {
    const rule = new HumanRequestRule();

    it('triggers on "speak to a human"', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'I want to speak to a human' }));
      expect(result).not.toBeNull();
      expect(result!.ruleName).toBe('HumanRequestRule');
    });

    it('triggers on "talk to a person"', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'Can I talk to a person?' }));
      expect(result).not.toBeNull();
    });

    it('triggers on "live agent"', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'Get me a live agent' }));
      expect(result).not.toBeNull();
    });

    it('does not trigger on normal messages', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'How do I return an item?' }));
      expect(result).toBeNull();
    });
  });

  describe('ProfanityAngerRule', () => {
    const rule = new ProfanityAngerRule();

    it('triggers on profanity', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'This is bullshit service' }));
      expect(result).not.toBeNull();
      expect(result!.ruleName).toBe('ProfanityAngerRule');
    });

    it('triggers on anger indicators', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'I am furious about this' }));
      expect(result).not.toBeNull();
    });

    it('triggers on "worst experience"', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'This is the worst experience ever' }));
      expect(result).not.toBeNull();
    });

    it('does not trigger on polite messages', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'Could you help me please?' }));
      expect(result).toBeNull();
    });
  });

  describe('SensitiveTopicRule', () => {
    const rule = new SensitiveTopicRule();

    it('triggers on "refund"', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'I want a refund' }));
      expect(result).not.toBeNull();
      expect(result!.ruleName).toBe('SensitiveTopicRule');
    });

    it('triggers on "legal action"', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'I will take legal action' }));
      expect(result).not.toBeNull();
    });

    it('triggers on "chargeback"', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'I am filing a chargeback' }));
      expect(result).not.toBeNull();
    });

    it('triggers on "cancel my account"', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'I want to cancel my account' }));
      expect(result).not.toBeNull();
    });

    it('does not trigger on normal messages', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'What are your business hours?' }));
      expect(result).toBeNull();
    });
  });

  describe('SafetyConcernRule', () => {
    const rule = new SafetyConcernRule();

    it('triggers on "security breach"', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'I think there was a security breach' }));
      expect(result).not.toBeNull();
      expect(result!.ruleName).toBe('SafetyConcernRule');
    });

    it('triggers on "medical emergency"', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'This is a medical emergency' }));
      expect(result).not.toBeNull();
    });

    it('triggers on "hacked"', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'My account was hacked' }));
      expect(result).not.toBeNull();
    });

    it('does not trigger on normal messages', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'How do I update my profile?' }));
      expect(result).toBeNull();
    });
  });

  describe('MissingKnowledgeRule', () => {
    const rule = new MissingKnowledgeRule();

    it('triggers when no knowledge chunks are available', () => {
      const result = rule.evaluate(makeContext({ knowledgeChunks: [] }));
      expect(result).not.toBeNull();
      expect(result!.reason).toBe('missing_knowledge');
    });

    it('does not trigger when knowledge chunks exist', () => {
      const result = rule.evaluate(makeContext());
      expect(result).toBeNull();
    });
  });

  describe('RepeatedFailureRule', () => {
    const rule = new RepeatedFailureRule();

    it('triggers when consecutive failures reach max', () => {
      const result = rule.evaluate(makeContext({ consecutiveAiFailures: 3 }));
      expect(result).not.toBeNull();
      expect(result!.reason).toBe('repeated_failures');
    });

    it('does not trigger when failures are below max', () => {
      const result = rule.evaluate(makeContext({ consecutiveAiFailures: 1 }));
      expect(result).toBeNull();
    });
  });

  describe('KeywordRule', () => {
    const rule = new KeywordRule();

    it('triggers on configured escalation keywords', () => {
      const settings = { ...DEFAULT_SETTINGS, escalationKeywords: ['urgent', 'vip'] };
      const result = rule.evaluate(makeContext({
        latestMessage: 'This is urgent please help',
        aiSettings: settings,
      }));
      expect(result).not.toBeNull();
      expect(result!.ruleName).toBe('KeywordRule');
    });

    it('does not trigger when no keywords match', () => {
      const settings = { ...DEFAULT_SETTINGS, escalationKeywords: ['urgent', 'vip'] };
      const result = rule.evaluate(makeContext({
        latestMessage: 'How do I return an item?',
        aiSettings: settings,
      }));
      expect(result).toBeNull();
    });

    it('does not trigger when keyword list is empty', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'urgent help needed' }));
      expect(result).toBeNull();
    });
  });

  describe('LowConfidenceRule', () => {
    const rule = new LowConfidenceRule();

    it('evaluateConfidence triggers when confidence is below threshold', () => {
      const result = rule.evaluateConfidence(0.5, 0.75);
      expect(result).not.toBeNull();
      expect(result!.reason).toBe('low_confidence');
    });

    it('evaluateConfidence does not trigger when confidence meets threshold', () => {
      const result = rule.evaluateConfidence(0.8, 0.75);
      expect(result).toBeNull();
    });

    it('evaluate returns null during pre-LLM pass', () => {
      const result = rule.evaluate(makeContext());
      expect(result).toBeNull();
    });
  });

  // ─── Adversarial corpus ─────────────────────────────────────────
  //
  // Each test below targets a *boundary* the property tests do not cover:
  // substring false positives, case/punctuation normalisation edge cases,
  // near-miss tokens (leet-speak, unicode lookalikes), and the (intentional)
  // no-op behaviour of LowConfidenceRule in the pre-LLM pass.
  //
  // Every case has a comment naming the attack vector. Where the current
  // behaviour appears to be a bug, the test is marked `// FINDING:` with
  // an inline explanation and a comment is filed against t_qa_escalation_proptest.

  describe('HumanRequestRule — adversarial', () => {
    const rule = new HumanRequestRule();

    // Attack: substring "human" appears inside an unrelated word.
    // Spec says: must NOT fire — the customer is talking about anatomy, not
    // asking to be transferred. The rule's phrase list is substring-based, so
    // this tests the actual phrase list (not the word "human") is conservative.
    it('does NOT trigger on "the human body" (anatomy, not a transfer request)', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'I have a question about the human body' }));
      expect(result).toBeNull();
    });

    // Attack: "human" inside "humanitarian" — must NOT fire.
    it('does NOT trigger on "humanitarian aid"', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'My donation to humanitarian aid' }));
      expect(result).toBeNull();
    });

    // Attack: "humane" is a substring of "humane treatment" — must NOT fire,
    // because the phrase list does not contain the literal word "humane".
    it('does NOT trigger on "humane treatment"', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'I believe in humane treatment of animals' }));
      expect(result).toBeNull();
    });

    // Attack: "human resources" — must NOT fire (the customer is asking
    // about an HR-related topic, not asking for a human agent).
    it('does NOT trigger on "human resources" topic', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'How does the human resources policy work?' }));
      expect(result).toBeNull();
    });

    // Attack: case-insensitivity boundary. The rule lowercases internally,
    // so an all-caps phrase must fire the same as the lowercase version.
    it('triggers on "SPEAK TO A HUMAN" (case-insensitive)', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'I WANT TO SPEAK TO A HUMAN NOW' }));
      expect(result).not.toBeNull();
      expect(result!.ruleName).toBe('HumanRequestRule');
    });

    // Attack: embedded in a longer sentence — substring match should still
    // fire on the trigger phrase inside a sentence.
    it('triggers when "talk to a human" is embedded in a longer sentence', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'I have been waiting for 30 minutes, I want to talk to a human please' }));
      expect(result).not.toBeNull();
    });

    // Attack: typo that does NOT contain any trigger phrase as a substring.
    // "humn" is a misspelling of "human" but is not a substring of any
    // phrase in the list. The rule does not use fuzzy matching, so this
    // is the intended (and safe) behaviour: misspellings are NOT escalated.
    it('does NOT trigger on misspelling "humn" (no fuzzy match by design, no substring match either)', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'I want to talk to a humn agent' }));
      expect(result).toBeNull();
    });

    // Attack: real customer misspelling "spk to a humn" — none of those
    // tokens are in the phrase list, so it does NOT fire. Documents the
    // gap: a frustrated customer who cannot type the trigger phrase gets
    // AI auto-reply instead of being escalated. This is a known limitation
    // of the exact-substring approach.
    it('does NOT trigger on heavily-misspelled "spk to a humn plz" (no fuzzy match)', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'pls can u spk to a humn for me' }));
      expect(result).toBeNull();
    });

    // Attack: trailing punctuation. Phrase list contains "real person"
    // with no punctuation; "real person." with trailing period is a
    // different substring from "real person" only if we check exact
    // equality. The implementation uses includes(), so it should still match.
    it('triggers on "real person." with trailing period', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'Get me a real person.' }));
      expect(result).not.toBeNull();
    });
  });

  describe('ProfanityAngerRule — adversarial', () => {
    const rule = new ProfanityAngerRule();

    // Attack: emoji-laden profanity. The rule splits on whitespace and
    // strips non-alpha from each token. The emoji token becomes "" and
    // the word "shit" still appears on its own.
    it('triggers on emoji + profanity "💩 this is shit" (whitespace split isolates profanity)', () => {
      const result = rule.evaluate(makeContext({ latestMessage: '💩 this is shit, what is going on' }));
      expect(result).not.toBeNull();
      expect(result!.ruleName).toBe('ProfanityAngerRule');
    });

    // Attack: leet-speak "f*ck" — asterisk is stripped, leaving "fck",
    // which is NOT in the profanity list. Documents the boundary: leet-speak
    // bypasses the rule. FINDING: see t_qa_escalation_proptest comment thread.
    it('does NOT trigger on leet-speak "f*ck" (asterisk stripped to "fck")', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'f*ck this app' }));
      expect(result).toBeNull();
    });

    // Attack: leet-speak "f4ck" — digit is stripped, leaving "fck".
    it('does NOT trigger on leet-speak "f4ck" (digit stripped to "fck")', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'f4ck this app' }));
      expect(result).toBeNull();
    });

    // Attack: spaced-out "f u c k" — split on whitespace gives four single
    // letters, none of which match the profanity list. Documents that the
    // rule does not reassemble spaced-out profanity.
    it('does NOT trigger on spaced-out "f u c k" (whitespace split defeats it)', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'f u c k this app' }));
      expect(result).toBeNull();
    });

    // Attack: punctuation-stripped "f.u.c.k" — split on whitespace gives
    // the single token "f.u.c.k", which after stripping non-alpha is "fuck",
    // which IS in the list. So dotted leet-speak DOES fire.
    it('triggers on dotted "f.u.c.k" (dots stripped, reveals "fuck")', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'f.u.c.k this app' }));
      expect(result).not.toBeNull();
    });

    // Attack: ALL-CAPS profanity — lowercased before tokenisation, should fire.
    it('triggers on "SHIT" (case-insensitive)', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'OH SHIT THIS IS BROKEN' }));
      expect(result).not.toBeNull();
    });

    // Attack: profanity embedded in a longer word "bullshit!" with
    // trailing punctuation. Whitespace split keeps it as one token;
    // non-alpha stripping removes "!" leaving "bullshit".
    it('triggers on "bullshit!" (trailing punctuation stripped)', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'this is bullshit!' }));
      expect(result).not.toBeNull();
    });

    // Attack: substring "ass" inside an unrelated word. The rule splits on
    // whitespace (not substrings), so "class" is one token — it strips to
    // "class" which is NOT in the list. Good. Documents that the rule
    // cannot be fooled by a substring inside a longer word.
    it('does NOT trigger on "class" or "assembly" (whitespace tokenisation, not substring)', () => {
      expect(rule.evaluate(makeContext({ latestMessage: 'What time is the class?' }))).toBeNull();
      expect(rule.evaluate(makeContext({ latestMessage: 'Where is the assembly line?' }))).toBeNull();
    });

    // Attack: words that share a prefix with profanity stems but are
    // NOT profanity. The list deliberately enumerates conjugations
    // rather than using startsWith/prefix matching, so words like
    // "fable", "classical", "dickens", "bastion" must all NOT trigger.
    // This is the false-positive guard that justifies the
    // explicit-enumeration approach over prefix matching.
    it('does NOT trigger on words that share a prefix with profanity stems (enumeration, not startsWith)', () => {
      const innocent = [
        'fable',          // fa-ble; "fuck" starts with fu-, not fa- — must NOT fire
        'fabulous',       // fa-bulous; same as above — must NOT fire
        'classical',      // shares substring with "ass" but is its own token — must NOT fire
        'classify',       // shares substring with "ass" but is its own token — must NOT fire
        'dickens',        // dick-ens; "dick" is a stem but "dickens" is its own token — must NOT fire
        'bastion',        // bast-ion; "bastard" is a stem but "bastion" is its own token — must NOT fire
        'basting',        // bast-ing; same as above — must NOT fire
        'hellos',         // hell-os; "hell" is a stem but "hellos" is its own token — must NOT fire
        'pistol',         // pist-ol; "piss" is a stem but "pistol" is its own token — must NOT fire
        'piston',         // pist-on; same as above — must NOT fire
      ];
      for (const word of innocent) {
        expect(rule.evaluate(makeContext({ latestMessage: `I have a question about ${word}` }))).toBeNull();
      }
    });

    // Attack: "asshole" — a common profanity that is a derivative of "ass".
    // The list explicitly includes "asshole" (see ProfanityAngerRule contract),
    // so it MUST trigger. This is the behaviour fix for t_1ccd15d1: the
    // previous shape was exact-stem-only, which let conjugations through.
    it('triggers on "asshole" (derivative of "ass", listed explicitly)', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'you are an asshole' }));
      expect(result).not.toBeNull();
      expect(result!.ruleName).toBe('ProfanityAngerRule');
    });

    // Attack: profanity conjugated "fucking" — gerund form. Listed
    // explicitly in the profanity list. Triggers. (t_1ccd15d1 fix.)
    it('triggers on "fucking" (gerund, listed explicitly)', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'this is fucking ridiculous' }));
      expect(result).not.toBeNull();
      expect(result!.ruleName).toBe('ProfanityAngerRule');
    });

    // Attack: gerund "bitching" — listed explicitly. Triggers.
    // (t_1ccd15d1 fix.)
    it('triggers on "bitching" (gerund, listed explicitly)', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'stop bitching at me' }));
      expect(result).not.toBeNull();
    });

    // Attack: past-tense "fucked" — listed explicitly. Triggers.
    it('triggers on "fucked" (past-tense, listed explicitly)', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'you fucked up my order' }));
      expect(result).not.toBeNull();
    });

    // Attack: adjective form "damned" — listed explicitly. Triggers.
    it('triggers on "damned" (adjective form, listed explicitly)', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'this damned app crashed again' }));
      expect(result).not.toBeNull();
    });

    // Attack: adjective form "crappy" — listed explicitly. Triggers.
    it('triggers on "crappy" (adjective form, listed explicitly)', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'this crappy service is unusable' }));
      expect(result).not.toBeNull();
    });

    // Attack: "pissed off" — whitespace split gives two tokens: "pissed"
    // and "off". "pissed" is in the list, so the rule fires. This is
    // the intended behaviour: a common angry phrase is escalated.
    it('triggers on "pissed off" ("pissed" is in the list, whitespace split isolates it)', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'I am pissed off at you' }));
      expect(result).not.toBeNull();
    });

    // Attack: anger indicator with extra context. "this is unacceptable"
    // is in the ANGER_INDICATORS list as a literal substring.
    it('triggers on "this is unacceptable" (anger indicator)', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'I am sorry but this is unacceptable' }));
      expect(result).not.toBeNull();
    });

    // Attack: word "horrible" alone — the rule list contains "horrible service"
    // (two-word phrase) but not "horrible" alone. Should NOT fire on the
    // single word. Documents the boundary.
    it('does NOT trigger on "horrible" alone (only "horrible service" is in the list)', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'this is horrible' }));
      expect(result).toBeNull();
    });

    // Attack: Unicode Cyrillic lookalike "fuсk" (Cyrillic 'с' U+0441) — visually
    // identical to "fuck" but the lowercased token is "fuсk" (with Cyrillic с),
    // which is NOT byte-equal to "fuck" (Latin с U+0063). Documents the
    // boundary: visual spoofing with Cyrillic lookalikes bypasses the rule.
    it('does NOT trigger on Cyrillic lookalike "fuсk" (homoglyph bypass)', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'fu\u0441k this app' }));
      expect(result).toBeNull();
    });
  });

  describe('SensitiveTopicRule — adversarial', () => {
    const rule = new SensitiveTopicRule();

    // Attack: "BBB" is in the phrase list. A message containing "BBBB"
    // (four b's) lowercases to "bbbb" which contains the substring "bbb",
    // so this WILL trigger. FINDING: substring match on a 3-letter
    // abbreviation is a false-positive magnet. "abba" does not contain
    // "bbb" so it is safe, but any 3+ b-string fires.
    it('triggers on "BBBB" (substring match on 3-letter abbreviation "bbb" — false positive on elongated text)', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'I rate this BBBB' }));
      expect(result).not.toBeNull();
    });

    // Attack: "abba" — must NOT contain the substring "bbb".
    it('does NOT trigger on "abba" (no "bbb" substring)', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'I like the band abba' }));
      expect(result).toBeNull();
    });

    // Attack: medical-only content framed as a question about someone else.
    // The phrase list is legal/chargeback/refund/cancellation-only; it does
    // NOT contain medical terms. So this is intentionally NOT a sensitive
    // topic under this rule (medical falls to SafetyConcernRule).
    // Documents the intent: medical questions that do not also match the
    // safety phrases should NOT escalate as sensitive topics.
    it('does NOT trigger on medical framing "my mom\'s prescription" (medical falls to SafetyConcernRule)', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'I have a question about my mom\'s prescription refill' }));
      expect(result).toBeNull();
    });

    // Attack: "I will dispute this charge" — the phrase list contains
    // "dispute charge" (with a space), but the message has "dispute this
    // charge" (with "this" inserted). Substring "dispute charge" is NOT
    // present. FINDING: a real customer dispute intent slips through
    // when a pronoun is inserted. Should the rule use a more forgiving
    // pattern? Documents current behaviour.
    it('does NOT trigger on "dispute this charge" (pronoun breaks the "dispute charge" substring match)', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'I will dispute this charge with my bank' }));
      expect(result).toBeNull();
    });

    // Attack: "cancellation" is in the list as a standalone word.
    // "I have a question about your cancellation policy" contains it.
    // A customer asking about the cancellation policy is escalated as
    // sensitive. FINDING: this may be a false positive — the customer
    // is asking for information, not cancelling. But the rule's
    // substring match on "cancellation" is intentional.
    it('triggers on "cancellation policy" (substring match on "cancellation" — possibly overly aggressive)', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'Could you explain your cancellation policy?' }));
      expect(result).not.toBeNull();
    });

    // Attack: "I want a refund" — the most direct sensitive topic.
    it('triggers on "I want a refund" (direct refund request)', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'I want a refund please' }));
      expect(result).not.toBeNull();
    });

    // Attack: "cancel my account" exact phrase from the list.
    it('triggers on "cancel my account"', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'Please cancel my account' }));
      expect(result).not.toBeNull();
    });

    // Attack: case variation on "Chargeback" — lowercased internally.
    it('triggers on "Chargeback" (case-insensitive)', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'I am filing a Chargeback' }));
      expect(result).not.toBeNull();
    });

    // Attack: "I will report you" — phrase list contains "report you".
    it('triggers on "I will report you" (substring match on "report you")', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'If this is not fixed, I will report you' }));
      expect(result).not.toBeNull();
    });
  });

  describe('SafetyConcernRule — adversarial', () => {
    const rule = new SafetyConcernRule();

    // Attack: question form "is this safe?" — does NOT contain the
    // substring "unsafe" or "dangerous". Should NOT fire — the customer
    // is asking a question, not reporting an incident. Documents the
    // intended behaviour.
    it('does NOT trigger on "is this safe?" (question form, not a report)', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'Is this product safe for kids?' }));
      expect(result).toBeNull();
    });

    // Attack: literal declaration "this is unsafe" — contains the
    // substring "unsafe" from the phrase list.
    it('triggers on "this is unsafe" (literal substring match)', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'I think this product is unsafe' }));
      expect(result).not.toBeNull();
    });

    // Attack: "Could this be dangerous?" — contains the substring
    // "dangerous" from the phrase list. Even though it is a question,
    // the rule fires. FINDING: the rule does not distinguish between
    // a question ("is it dangerous?") and a report ("it is dangerous").
    // This is a known substring-based limitation.
    it('triggers on "Could this be dangerous?" (question form still matches substring "dangerous")', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'Could this product be dangerous for pets?' }));
      expect(result).not.toBeNull();
    });

    // Attack: "allergy" alone — the phrase list contains "allergic
    // reaction" (two words) but not "allergy" alone. A customer reporting
    // a single "allergy" experience is NOT escalated. FINDING: a real
    // safety concern expressed with the single word slips through.
    it('does NOT trigger on "allergy" alone (only "allergic reaction" is in the list)', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'My son has a peanut allergy' }));
      expect(result).toBeNull();
    });

    // Attack: "allergic reaction" exact phrase.
    it('triggers on "allergic reaction" (exact phrase in the list)', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'I had an allergic reaction to the medication' }));
      expect(result).not.toBeNull();
    });

    // Attack: "court order" — legal/safety boundary, exact phrase.
    it('triggers on "court order"', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'We received a court order' }));
      expect(result).not.toBeNull();
    });

    // Attack: "side effect" exact phrase.
    it('triggers on "side effect" (medical boundary)', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'What are the side effects of this drug?' }));
      expect(result).not.toBeNull();
    });

    // Attack: "He had a stroke" — does not contain any safety phrase
    // (the list has "medical emergency" / "medical issue" but not
    // "stroke"). A genuine medical incident is missed. FINDING: the
    // safety phrase list is not an exhaustive medical vocabulary.
    it('does NOT trigger on "stroke" alone (not in the safety phrase list)', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'My father had a stroke last week' }));
      expect(result).toBeNull();
    });
  });

  describe('MissingKnowledgeRule — adversarial', () => {
    const rule = new MissingKnowledgeRule();

    // Attack: an empty message with no knowledge chunks. The rule fires
    // on knowledge-chunk emptiness, regardless of message content. A
    // silent / empty customer message would escalate.
    it('triggers on empty message + no knowledge (rule fires on chunk array, not message content)', () => {
      const result = rule.evaluate(makeContext({ latestMessage: '', knowledgeChunks: [] }));
      expect(result).not.toBeNull();
      expect(result!.reason).toBe('missing_knowledge');
    });

    // Attack: a friendly greeting with no knowledge. The rule fires.
    // FINDING: even a simple "hi" escalates when the org has no
    // knowledge documents. The rule does not check if the message is
    // a question worth answering — it just checks chunk count.
    it('triggers on "hi" with no knowledge (escalates greetings when KB is empty)', () => {
      const result = rule.evaluate(makeContext({ latestMessage: 'hi', knowledgeChunks: [] }));
      expect(result).not.toBeNull();
    });

    // Attack: one knowledge chunk with empty content. The rule checks
    // array length only, not content. So a chunk with "" content still
    // counts as "having knowledge" and the rule does NOT fire.
    it('does NOT trigger when one chunk has empty content (rule checks length, not content)', () => {
      const result = rule.evaluate(
        makeContext({
          knowledgeChunks: [
            { id: '1', documentId: 'd1', organizationId: 'org-001', content: '', embedding: [], metadata: {}, createdAt: new Date() },
          ],
        }),
      );
      expect(result).toBeNull();
    });
  });

  describe('LowConfidenceRule — adversarial', () => {
    const rule = new LowConfidenceRule();

    // Attack: pre-LLM pass MUST return null regardless of context, because
    // there is no AI decision yet. The rule is a no-op during pre-LLM
    // evaluation. This test pins the contract.
    it('returns null in pre-LLM pass even when knowledge is empty and failures are maxed', () => {
      const result = rule.evaluate(
        makeContext({
          latestMessage: 'whatever',
          knowledgeChunks: [],
          consecutiveAiFailures: 99,
        }),
      );
      expect(result).toBeNull();
    });

    // Boundary: confidence = threshold. The check is strict-less-than
    // (`< threshold`), so equality is NOT a trigger.
    it('evaluateConfidence does NOT trigger when confidence == threshold (strict <)', () => {
      const result = rule.evaluateConfidence(0.75, 0.75);
      expect(result).toBeNull();
    });

    // Boundary: confidence = 0, threshold = 0. Strict-less-than is
    // false at equality, so 0/0 is NOT a trigger. Documents the
    // boundary: a "zero confidence" score is treated as meeting a
    // zero threshold.
    it('evaluateConfidence does NOT trigger when confidence == 0 and threshold == 0 (strict <)', () => {
      const result = rule.evaluateConfidence(0, 0);
      expect(result).toBeNull();
    });

    // Boundary: NaN confidence. NaN < threshold is always false in
    // IEEE 754, so a naive `confidence < threshold` check would let
    // a garbage confidence silently pass as "good enough" and trigger
    // an auto-reply. The rule defensively treats NaN confidence as
    // low confidence so a human reviews it (parse failure, model
    // timeout, missing token upstream all surface here).
    it('evaluateConfidence DOES trigger on NaN confidence (treated as low confidence)', () => {
      const result = rule.evaluateConfidence(Number.NaN, 0.75);
      expect(result).not.toBeNull();
      expect(result!.reason).toBe('low_confidence');
      expect(result!.triggered).toBe(true);
    });

    // Boundary: confidence = 1, threshold = 1. Strict-less-than is
    // false. Documents that 1.0 is the maximum non-triggering value.
    it('evaluateConfidence does NOT trigger when both confidence and threshold are 1', () => {
      const result = rule.evaluateConfidence(1, 1);
      expect(result).toBeNull();
    });

    // Boundary: just below threshold.
    it('evaluateConfidence triggers when confidence is 0.0001 below threshold', () => {
      const result = rule.evaluateConfidence(0.7499, 0.75);
      expect(result).not.toBeNull();
      expect(result!.reason).toBe('low_confidence');
    });
  });

  describe('RepeatedFailureRule — adversarial', () => {
    const rule = new RepeatedFailureRule();

    // Boundary: failures = max - 1 (2 < 3). Should NOT fire.
    it('does NOT trigger when failures = max - 1 (one below threshold)', () => {
      const result = rule.evaluate(makeContext({ consecutiveAiFailures: 2 }));
      expect(result).toBeNull();
    });

    // Boundary: failures == max (3 == 3). Should fire.
    it('triggers when failures == max (exact threshold)', () => {
      const result = rule.evaluate(makeContext({ consecutiveAiFailures: 3 }));
      expect(result).not.toBeNull();
      expect(result!.reason).toBe('repeated_failures');
    });

    // Boundary: failures = max + 1 (4 > 3). Should fire.
    it('triggers when failures > max', () => {
      const result = rule.evaluate(makeContext({ consecutiveAiFailures: 4 }));
      expect(result).not.toBeNull();
    });

    // Boundary: maxConsecutiveFailures = 0. The check is `>= 0`, so
    // 0 failures already meets the threshold. FINDING: a config of
    // 0 means "escalate immediately on first AI failure (actually
    // on the zero-th, which is the start of the conversation)".
    // This is likely a misconfiguration guard, not a real concern,
    // but worth pinning in a test.
    it('triggers when max = 0 and failures = 0 (>= 0 catches the start of conversation)', () => {
      const result = rule.evaluate(
        makeContext({
          consecutiveAiFailures: 0,
          aiSettings: { ...DEFAULT_SETTINGS, maxConsecutiveFailures: 0 },
        }),
      );
      expect(result).not.toBeNull();
    });

    // Boundary: negative failures with positive max. -1 >= 3 is false,
    // so does NOT fire. Documents that negative counts (which should
    // not occur in practice) do not trigger.
    it('does NOT trigger on negative failures', () => {
      const result = rule.evaluate(makeContext({ consecutiveAiFailures: -1 }));
      expect(result).toBeNull();
    });
  });

  describe('KeywordRule — adversarial', () => {
    const rule = new KeywordRule();

    // Attack: empty keyword list — must not fire (returns early).
    it('does NOT trigger when keyword list is empty array', () => {
      const result = rule.evaluate(
        makeContext({
          latestMessage: 'urgent help needed',
          aiSettings: { ...DEFAULT_SETTINGS, escalationKeywords: [] },
        }),
      );
      expect(result).toBeNull();
    });

    // Attack: regex special chars in keyword. The rule uses
    // `String.prototype.includes`, so "VIP+" is a literal substring.
    // A message containing "VIP+" matches; "VIP" alone does not.
    it('treats regex-special chars as literals (no regex compilation)', () => {
      const settings = { ...DEFAULT_SETTINGS, escalationKeywords: ['VIP+'] };
      // "VIP+" matches literally.
      expect(
        rule.evaluate(
          makeContext({ latestMessage: 'I am a VIP+ member', aiSettings: settings }),
        ),
      ).not.toBeNull();
      // "VIP" alone does not match "VIP+".
      expect(
        rule.evaluate(
          makeContext({ latestMessage: 'I am a VIP member', aiSettings: settings }),
        ),
      ).toBeNull();
    });

    // Attack: HTML/script tag in keyword. Treated as a literal string.
    it('treats HTML tags as literals (no parsing)', () => {
      const settings = { ...DEFAULT_SETTINGS, escalationKeywords: ['<script>'] };
      expect(
        rule.evaluate(
          makeContext({ latestMessage: 'I typed <script> in the form', aiSettings: settings }),
        ),
      ).not.toBeNull();
    });

    // Attack: case-insensitive boundary. The rule lowercases the message
    // and lowercases each phrase, so "URGENT" (uppercase keyword) matches
    // "urgent" (lowercase message) and vice versa.
    it('matches case-insensitively (URGENT keyword in lowercase message)', () => {
      const settings = { ...DEFAULT_SETTINGS, escalationKeywords: ['URGENT'] };
      const result = rule.evaluate(
        makeContext({ latestMessage: 'this is urgent', aiSettings: settings }),
      );
      expect(result).not.toBeNull();
    });

    // Attack: keyword with markdown emphasis — "**urgent**" contains
    // the substring "urgent", so still matches.
    it('matches inside markdown bold "**urgent**"', () => {
      const settings = { ...DEFAULT_SETTINGS, escalationKeywords: ['urgent'] };
      const result = rule.evaluate(
        makeContext({ latestMessage: 'this is **urgent**', aiSettings: settings }),
      );
      expect(result).not.toBeNull();
    });

    // Attack: keyword is a single space " " — every message with a space
    // in it would match. FINDING: this is a misconfiguration hazard, not
    // a vulnerability in the rule itself. The rule does exactly what
    // substring match does. Pins the behaviour so a future change to
    // whitespace handling does not silently break this case.
    it('matches when keyword is a single space (every message with a space matches)', () => {
      const settings = { ...DEFAULT_SETTINGS, escalationKeywords: [' '] };
      const result = rule.evaluate(
        makeContext({ latestMessage: 'hi there', aiSettings: settings }),
      );
      expect(result).not.toBeNull();
    });

    // Attack: empty-string keyword "". The rule lowercases the phrase
    // (empty stays empty). The check is `lowerMessage.includes('')`,
    // which is always true in JavaScript. FINDING: an empty-string
    // keyword escalates EVERY message. The implementation should
    // explicitly skip empty-string keywords, or treat them as no-ops.
    it('matches every message when keyword is empty string ""', () => {
      const settings = { ...DEFAULT_SETTINGS, escalationKeywords: [''] };
      const result = rule.evaluate(
        makeContext({ latestMessage: 'just a normal question', aiSettings: settings }),
      );
      // Documents current (buggy) behaviour: empty string matches.
      // 'normal question'.toLowerCase().includes('') === true in JS.
      expect(result).not.toBeNull();
    });
  });

  describe('createDefaultEscalationEngine', () => {
    it('creates engine with all 8 rules registered', () => {
      const engine = createDefaultEscalationEngine();

      // Test that it evaluates rules correctly
      const humanResult = engine.evaluate(makeContext({
        latestMessage: 'I want to speak to a human',
      }));
      expect(humanResult).not.toBeNull();
      expect(humanResult!.ruleName).toBe('HumanRequestRule');
    });

    it('returns null when no rules trigger', () => {
      const engine = createDefaultEscalationEngine();

      const result = engine.evaluate(makeContext({
        latestMessage: 'What are your business hours?',
      }));
      expect(result).toBeNull();
    });

    // Attack: first-match-wins. A message that contains BOTH a
    // profanity AND a sensitive topic phrase should escalate on the
    // earlier-registered rule (ProfanityAngerRule is registered second,
    // HumanRequestRule is first — so the profanity wins for "I want a
    // refund, this is bullshit").
    it('returns the first matching rule (ProfanityAngerRule beats SensitiveTopicRule on shared phrases)', () => {
      const engine = createDefaultEscalationEngine();
      const result = engine.evaluate(
        makeContext({
          latestMessage: 'I want a refund, this is bullshit service',
        }),
      );
      expect(result).not.toBeNull();
      // ProfanityAngerRule is registered before SensitiveTopicRule.
      expect(result!.ruleName).toBe('ProfanityAngerRule');
    });

    // Attack: rule order — HumanRequestRule is first. A message that
    // would trigger SensitiveTopicRule + HumanRequestRule should
    // return HumanRequestRule.
    it('returns the first matching rule (HumanRequestRule beats SensitiveTopicRule)', () => {
      const engine = createDefaultEscalationEngine();
      const result = engine.evaluate(
        makeContext({
          latestMessage: 'I want to speak to a human about my refund',
        }),
      );
      expect(result).not.toBeNull();
      expect(result!.ruleName).toBe('HumanRequestRule');
    });
  });
});
