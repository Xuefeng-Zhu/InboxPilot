# Adding an Escalation Rule

> Step-by-step guide for adding a new rule to the deterministic escalation engine.

## Overview

The `EscalationEngine` (`packages/support-core/src/interfaces/escalation.ts`) evaluates rules in registration order. The first rule that triggers wins. If any rule triggers, the conversation is escalated to a human agent and the AI pipeline is bypassed.

There are 8 built-in rules in `packages/support-core/src/services/escalation-rules.ts`:

| # | Rule | Purpose |
|---|---|---|
| 1 | `HumanRequestRule` | Customer asks for a human |
| 2 | `ProfanityAngerRule` | Profanity or anger indicators |
| 3 | `SensitiveTopicRule` | Legal, chargeback, refund, cancellation |
| 4 | `SafetyConcernRule` | Security breach, medical emergency, safety hazard |
| 5 | `MissingKnowledgeRule` | No knowledge chunks matched |
| 6 | `LowConfidenceRule` | Post-LLM only |
| 7 | `RepeatedFailureRule` | Consecutive AI failures exceeded |
| 8 | `KeywordRule` | Organization-configured escalation keywords |

## Adding a new rule

### 1. Create the rule

Add a new class to `packages/support-core/src/services/escalation-rules.ts`:

```typescript
export class YourNewRule implements EscalationRule {
  readonly name = 'YourNewRule';

  evaluate(context: EscalationContext): EscalationResult | null {
    // Inspect context.latestMessage, context.knowledgeChunks, etc.
    if (/* your condition */) {
      return {
        triggered: true,
        reason: 'short human-readable explanation',
        ruleName: this.name,
      };
    }
    return null;
  }
}
```

`EscalationContext` (in `escalation.ts`) gives you access to:
- `latestMessage: string`
- `conversationHistory: Message[]`
- `knowledgeChunks: KnowledgeChunk[]`
- `knowledgeSimilarityThreshold: number`
- `aiSettings: AiSettings`
- `consecutiveAiFailures: number`

`EscalationResult` is `{ triggered: true; reason: string; ruleName: string }`. Return `null` if the rule doesn't trigger.

### 2. Register the rule

Add the new rule to `createDefaultEscalationEngine()` at the bottom of the same file:

```typescript
export function createDefaultEscalationEngine(): EscalationEngine {
  const engine = new EscalationEngine();

  engine.register(new HumanRequestRule());
  engine.register(new ProfanityAngerRule());
  engine.register(new SensitiveTopicRule());
  engine.register(new SafetyConcernRule());
  engine.register(new MissingKnowledgeRule());
  engine.register(new LowConfidenceRule());
  engine.register(new RepeatedFailureRule());
  engine.register(new KeywordRule());
  // Add your new rule here. Order matters — the first to trigger wins.
  engine.register(new YourNewRule());

  return engine;
}
```

### 3. Export it (if used outside the file)

If your rule is needed by tests or other services, add it to the `services/index.ts` barrel:

```typescript
export {
  // ...
  YourNewRule,
} from './escalation-rules.js';
```

### 4. Write tests

Add property-based test cases to `packages/support-core/__tests__/properties/escalation.prop.test.ts`:

```typescript
it('Property 18: YourNewRule triggers for [expected input patterns]', () => {
  fc.assert(
    fc.property(fc.string(), (message) => {
      const engine = new EscalationEngine();
      engine.register(new YourNewRule());

      const result = engine.evaluate({
        latestMessage: messageContainingYourTrigger,
        conversationHistory: [],
        knowledgeChunks: [],
        knowledgeSimilarityThreshold: 0.7,
        aiSettings: defaultSettings,
        consecutiveAiFailures: 0,
      });

      return result?.ruleName === 'YourNewRule';
    }),
    { numRuns: 100 },
  );
});
```

Also add an example-based unit test case to `__tests__/unit/escalation-engine.test.ts` covering the rule's exact trigger conditions.

### 5. Update documentation

Add the new rule to the table in [`../reference/architecture.md`](../reference/architecture.md#services-12) (services section). The rule will automatically appear in the `ai_decisions.raw_response.ruleName` field when triggered.

## Design considerations

- **Order matters.** Place higher-priority rules first. For example, a new "PII detected" rule should run *before* `MissingKnowledgeRule` to escalate when sensitive PII is present even if knowledge matches.
- **Pure functions.** Rules should be deterministic and side-effect-free. All inputs come from `EscalationContext`.
- **Pre-LLM only.** The `EscalationEngine` runs *before* the LLM call. If you need to evaluate against LLM output, use a post-LLM check directly in `AiAgentService` (see `LowConfidenceRule.evaluateConfidence` for the pattern).
- **Don't throw.** Return `null` for "doesn't apply" and `EscalationResult` for "triggers". Throwing breaks the engine.
- **Reason string** is shown in the AI draft UI and stored in `ai_decisions.reasoning_summary`. Make it short and human-readable.
- **No I/O.** Rules must be synchronous. Do not query the DB or call external services from a rule. (If you need external data, load it into the `EscalationContext` upstream.)

## Examples of rule shapes

A simple keyword rule:

```typescript
export class PiiDetectedRule implements EscalationRule {
  readonly name = 'PiiDetectedRule';
  // crude regex; production should use a proper PII detector
  private piiPattern = /\b\d{3}-\d{2}-\d{4}\b/; // SSN

  evaluate(context: EscalationContext): EscalationResult | null {
    if (this.piiPattern.test(context.latestMessage)) {
      return { triggered: true, reason: 'PII (SSN) detected in message', ruleName: this.name };
    }
    return null;
  }
}
```

A rule that uses AI settings:

```typescript
export class HighValueCustomerRule implements EscalationRule {
  readonly name = 'HighValueCustomerRule';

  evaluate(context: EscalationContext): EscalationResult | null {
    const tags = context.aiSettings.escalationKeywords; // example
    if (tags.includes('vip')) {
      return { triggered: true, reason: 'VIP customer', ruleName: this.name };
    }
    return null;
  }
}
```
