# Multi-Round AI Reply — Fix Plan

**Status:** Proposed, awaiting approval
**Date:** 2026-06-08
**Author:** opencode (QA session)
**Scope:** `packages/support-core/src/services/ai-agent-service.ts`

## Background

A markdown conversion was applied to 3 FAQ rows in the `knowledge_documents`
table (live IDs `d1aca0d4-...`, `d154102a-...`, `b22b3f06-...`), transforming
plain-text `Q: ...\nA: ...` blocks into proper `### Q: ...\n\nA: ...` markdown
headings. Chunks were deleted and `process_knowledge_document` jobs were
flushed so embeddings regenerated against the new content.

A follow-up end-to-end QA of the inbox (4 FAQ scenarios + escalation paths +
multi-round conversation tests) was run to verify the conversion did not
regress retrieval or downstream flows.

**Markdown conversion result: PASS** — every in-scope FAQ retrieval returned
the right content with confidence 0.80-1.00.

**Multi-round result: 3 of 5 scenarios fully pass; 2 scenarios have 1 turn
each failing.** The failures are all in LLM judgment (multi-turn context +
escalation decisions), not in retrieval or markdown rendering.

## Findings

### Issue 1 — Context disambiguation doesn't work for vague follow-ups (Scenario C, turn 2)

**Repro:**
1. Customer: "What is your return policy?"
2. AI: "We accept returns within 30 days of delivery. ... Refunds are processed within 5-7 business days..."
3. Customer: "How long does that take?"
4. AI: "Standard shipping takes 5-7 business days, while express shipping takes 2-3 business days." ❌

**Expected:** The AI should answer about refund processing time (5-7 business
days) using the conversation context.

**Actual:** The AI retrieved the shipping FAQ, ignoring the prior turn.

**Root cause:** `AiAgentService.processMessage` embeds only the latest message
for the `match_knowledge_chunks` RPC call. The conversation history is passed
in the LLM prompt *after* retrieval, so the retriever has no signal that
"that" refers to the refund. A vague follow-up like "How long does that
take?" embeds close to the generic shipping FAQ chunks.

**Evidence in code:** `packages/support-core/src/services/ai-agent-service.ts`
Step 4 ("Embed + match knowledge") uses `latestMessage = messages[messages.length - 1].body`.

### Issue 2 — Aggressive escalation on "I tried that" follow-up (Scenario D, turn 2)

**Repro:**
1. Customer: "The app is not loading"
2. AI: "Please try clearing your browser cache and cookies ... try a different browser or disabling any extensions"
3. Customer: "I tried that but it's still not working"
4. AI: `decision_type: 'escalate'`, empty response, reasoning: "potential deeper issue that may require further investigation" ❌

**Expected:** A concrete next step (e.g., check internet, try incognito,
contact support email), or at least a draft for human review.

**Actual:** The LLM chose to escalate directly.

**Root cause:** No escalation rule triggered (the message does not contain
any sensitive-topic or profanity-anger keywords). The LLM, given a `draft_only`
mode and the message content, judged the user wanted human help. The system
prompt is silent on the preferred behavior for "I tried that" follow-ups, so
the model defaults to the conservative "escalate" outcome.

### Issue 3 — Aggressive escalation on mild frustration (Scenario E, turn 1)

**Repro:**
1. Customer: "This is so frustrating, nothing works"
2. AI: `decision_type: 'escalate'`, empty response, tags: `shipping, payment, returns, customer frustration` ❌

**Expected:** An empathetic response asking for details ("I'm sorry to hear
that — could you tell me more about what's not working?").

**Actual:** Direct escalation, without an attempt at empathy.

**Root cause:** Same as Issue 2 — no rule triggered, LLM made the call
independently. The system prompt does not bias toward "respond with empathy
first" before escalating on negative emotion.

## Fixes

### Fix #1 — Context-Aware RAG Retrieval (addresses Issue 1)

**File:** `packages/support-core/src/services/ai-agent-service.ts`
**Lines:** ~Step 4 of `processMessage` (embed + match knowledge)

**Change:** Concatenate the last N contact messages into a single string
and embed that, instead of embedding only the latest message.

```ts
// Add at the top of the file or as a module constant
const RECENT_TURNS_FOR_RETRIEVAL = 3;

// In processMessage, replace the existing:
//   const latestMessage = messages[messages.length - 1].body;
//   const embedding = await aiClient.createEmbedding({ model, input: latestMessage });
// with:

const recentContactTurns = messages
  .filter(m => m.senderType === 'contact')
  .slice(-RECENT_TURNS_FOR_RETRIEVAL);

const retrievalQuery = recentContactTurns.length > 0
  ? recentContactTurns.map(m => m.body).join(' ')
  : messages[messages.length - 1].body;

const embedding = await aiClient.createEmbedding({
  model: 'text-embedding-ada-002',
  input: retrievalQuery,
});
const chunks = await knowledgeRepo.matchChunks(embedding, orgId, 5, knowledgeSimilarityThreshold);
```

**Why N=3:** Covers the immediate prior turn + 1 turn of prior context. Beyond
3, the signal dilutes for short, FAQ-style questions. The chunker has a 500-char
max per chunk, so 3 turns of typical customer messages (~50-150 chars each)
stay well under embedding model context limits.

**Backward compatibility:** When there's only 1 contact message in the
thread, the filter+slice yields exactly that one message, and
`join(' ')` produces an identical string to `messages[last].body`. Net
behavior: identical to current for first-turn conversations.

**Cost:** No measurable cost change — one 1536-dim embedding per call either
way; the input string is slightly longer but well within `text-embedding-ada-002`'s
context window (8192 tokens).

**Risk:** Low. If noisy multi-turn threads start retrieving off-topic chunks
(e.g., customer cycles between billing and shipping), the existing
`knowledge_similarity_threshold` (0.7) plus the LLM's prompt-level filtering
should handle it.

### Fix #2 — Prompt Tuning: Bias Toward Resolution (addresses Issues 2 and 3)

**File:** `packages/support-core/src/services/ai-agent-service.ts`
**Lines:** `buildPrompt()` — where the system message is constructed.

**Change:** Add a behavior-guidance block to the system message that prefers
empathy + next-step responses over escalation for negative emotion or
"I tried that" follow-ups.

```ts
// Inside buildPrompt(), construct the system message:

const behaviorGuidance = `
Behavior guidance:
- When the customer expresses frustration, acknowledge it empathetically first, then ask a clarifying question or offer a concrete next step. Do not escalate on frustration alone.
- When the customer says they already tried your suggested steps, do not escalate immediately. Offer an alternative (advanced troubleshooting step, different channel, or clarifying question) before considering escalation.
- Only escalate to a human if (a) the customer explicitly asks, (b) the topic is sensitive (legal, safety, chargeback), or (c) you have already offered a next step and the customer has rejected it.`;

const systemMessage = [
  aiSettings.systemPrompt,
  behaviorGuidance,
  KNOWLEDGE_SECTION,
  JSON_SCHEMA_SPEC,
].filter(Boolean).join('\n\n');
```

**Why this is safe:**
- The escalation rules (HumanRequestRule, SensitiveTopicRule, etc.) still run
  pre-LLM and bypass the prompt entirely. Sensitive topics still escalate.
- Post-LLM checks (LowConfidenceRule, parse failure) still apply.
- The change only affects the LLM's tendency to choose `escalate` over
  `respond` when both are valid.

**Risk:** Low. Easily reversible by removing the `behaviorGuidance` block.
If over-correction is observed (AI never escalates on negative emotion), the
directive can be tightened to "after one empathetic response and one next-step
attempt, escalate if the customer is still frustrated."

### Fix #3 — Deferred: Query Rewriting (NOT in this round)

Considered but **not recommended for this iteration.** A separate LLM call
to rewrite the latest message in self-contained form (e.g., "What is your
return policy? How long does that take?" → "How long does refund processing
take after a return?") would handle highly ambiguous cases, but:

- Fix #1 already addresses the primary repro (C.2) at zero added cost.
- Query rewriting adds ~$0.001/call + 1-2s latency per inbound.
- Re-evaluate after Fix #1 lands; if new vague-follow-up repros surface,
  revisit.

## Implementation Order

1. **Fix #1** (code change, ~12 lines, single file)
2. **Fix #2** (prompt string, ~10 lines, same file)
3. Re-run all 5 multi-round scenarios as regression
4. (Optional) Add a property-based test for multi-turn context retrieval
5. Update `docs/guides/local-development.md` or `docs/reference/testing.md` if the property test lands

## Verification Plan

After both fixes land, re-run the full multi-round suite using
`node scripts/mock-sms.mjs inbound "<msg>"` with 4-second sleeps between
messages (avoid the pre-existing race condition). Expected new results:

| Scenario | Turn | Before | After |
|---|---|---|---|
| C | 2 — "How long does that take?" | ❌ shipping answer | ✅ refund timing (5-7 business days) |
| D | 2 — "I tried that but it's still not working" | ❌ escalate | ✅ next step (e.g., "try incognito or contact support@...") |
| E | 1 — "This is so frustrating, nothing works" | ❌ escalate | ✅ empathy + clarifying question |

**Regression checks (must NOT change):**
- Scenarios A.1, A.2, B.1, B.2, E.2 — all should still pass
- Escalation rules 4.1 (human request) and 4.2 (legal threat) — must still
  trigger `decision_type='escalate'` because they fire pre-LLM
- The 4 original E2E FAQ questions from the previous QA (shipping, billing,
  troubleshooting, return policy) — confidence should remain ≥ 0.7

**Unit tests:**
- Existing 341 support-core tests must still pass
- New property-based test (optional): generate random 2-5 turn conversation
  threads, verify the retrieval query is the concatenation of the last 3
  contact messages, not just the latest

## Rollback

Both fixes are localized to `ai-agent-service.ts` and reversible by reverting
the commit. The knowledge base itself is unchanged (no migration needed).
No database, schema, or env-var changes. The pre-existing race condition
remains unchanged and out of scope.

## Out of Scope

- The pre-existing message_id race condition (separate bug)
- `next lint` failure (pre-existing on this branch)
- The `send_outbound_message` job stub (auto_reply mode doesn't actually send)
- Lack of knowledge citation rendering in the AI Insight panel

## Estimated Effort

- Fix #1: 10 minutes
- Fix #2: 5 minutes
- Regression run: 5 minutes wall clock, ~$0.05 in LLM tokens
- Total: ~20 minutes
