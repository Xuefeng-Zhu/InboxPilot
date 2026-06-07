# InboxPilot — Pricing & Packaging Hypothesis (v1)

> Status: **hypothesis, not a final answer.** This is a structured bet engineering can
> build gating logic against and sales can take to design partners. Prices here are
> placeholders; real prices get set after the first 5 design-partner conversations
> (see §"Open questions" at the bottom). Pair with:
> `.kiro/specs/ai-customer-support/requirements.md` (PRD) · `DATABASE.md` ·
> `ARCHITECTURE.md` · `LAUNCH_CHECKLIST.md` §7 ·
> `SUPPORT_PLAYBOOK.md` · `legal/DPA.md` · `legal/AUP.md` ·
> **`COMPETITIVE.md`** (the Front / Intercom Fin / Ada / Forethought / DIY one-pagers — every tier boundary here is a "vs X" choice named there)
> Kanban: `t_pm_pricing_packaging` (parent: `t_pm_launch_checklist`)

## 0. The one rule that governs this document

**Every tier boundary must map to a check we can do in code.**

- A boundary that reads "more value" or "priority support" is marketing fluff and gets cut.
- A boundary that reads "AI auto-reply mode `auto_reply` (≥ `ai_settings.confidence_threshold`)" is enforceable and stays.

Concretely, every boundary in this document resolves to one of:

1. A row in a new `organization_subscriptions` table (tier, quota, lifecycle).
2. A flag in `ai_settings` (`ai_mode`, `confidence_threshold`, `escalation_keywords`).
3. A row count in `organization_members` (seat cap).
4. A row count in `knowledge_documents` (KB cap).

If we ever propose a tier boundary that does not resolve to one of those four checks, we either rewrite the boundary or we cut the boundary.

---

## 1. The 3 tiers at a glance

| | **Starter** | **Growth** | **Scale** |
|---|---|---|---|
| **Price (placeholder)** | **$0** | **$99 / mo** | **$499 / mo** |
| **Conversation quota (included)** | 50 / mo | 1,000 / mo | 10,000 / mo |
| **Overage** | hard stop (no more inbound) | **$0.10 / conversation** | **$0.05 / conversation** |
| **Channels** | SMS **OR** email (pick one) | SMS **and** email | SMS **and** email |
| **Seats** | 1 (owner only) | 5 (any role) | unlimited |
| **Knowledge base** | 5 documents | 50 documents | unlimited |
| **AI auto-reply** | **off** (draft-only) | **on** (above per-tenant threshold) | **on** (above per-tenant threshold) |
| **Custom escalation keywords** | ❌ (defaults only) | ❌ (defaults only) | ✅ |
| **Audit log export** | ❌ | ❌ | ✅ (CSV / JSON, last 90d) |
| **Stripe status required to be active** | n/a (free) | `active` or `trialing` | `active` or `trialing` |

**Why these breakpoints and not, say, 100 / 500 / 5,000?**
- The 50/1000/10000 ladder matches the seed data shape (Acme Support gets 5 conversations
  and stays comfortably inside Starter; a 5-person SaaS doing ~700 conversations/month is
  Growth; a multi-product support org doing 6,000+ is Scale). The breaks fall at natural
  customer moments, not round numbers.
- The overage curve (0.10 → 0.05) is a 2× volume discount that still keeps the unit
  economics positive: at 0.05/conversation on a GPT-4o-mini run, our cost is well under
  $0.02/conversation (per the LAUNCH_CHECKLIST §4.3 metric), so Scale is our most
  profitable tier by margin.

---

## 2. Per-tier detail

### 2.1 Starter — $0 / 50 conversations / mo

**Rationale.** This is the hook. The thesis is: a small business with <50
conversations/month has *no business* paying for AI support yet, and a $0 tier with real
value (drafts, knowledge retrieval, one channel, one seat) is the cheapest way to get
them in the door, get them to upload a knowledge doc, and have them hit the wall at
50 conversations. The wall is the *next* conversation they're going to have; the upsell
is a one-click plan change, not a sales call.

**What this tier IS.**
- A solo owner can connect a phone number or an email address, upload 5 docs
  (FAQ + a couple of product pages), and have the AI draft replies for every inbound.
- AI mode is `draft_only` — the owner reviews and clicks send. This is the safe
  default: no AI-sent-reply risk for a brand-new customer.
- Audit log captures every draft, every approve/skip, every inbound — even on the
  free tier, we have observability.

**What this tier is NOT.**
- Not a multi-seat tool. If you have 2+ people answering, you outgrew Starter on day 1.
- Not for SMS-heavy businesses. The channel is exclusive: pick SMS *or* email, not both.
  If you need both, the next conversation is about Growth.
- Not for AI-sent-reply. Drafts are the deliverable; send-button is the human's job.
- Not a permanent free lunch. The 50/mo quota is hard — the 51st conversation gets
  rejected at the webhook, not silently dropped. We tell the contact we received their
  message and route to email; the owner gets a "you hit your limit" banner in the inbox.

**Code-enforced boundaries.**
- `ai_settings.ai_mode` is forced to `draft_only` (a server-side setter blocks any
  attempt to write `auto_reply` while the org's tier is Starter).
- `organizations.metadata.active_channel` (new key) is one of `sms` or `email`,
  chosen at signup. The webhooks for the *other* channel are returned with a
  `402 Payment Required`-style payload to the provider (Twilio/Postmark will
  retry, so we also persist a `rejected_inbound` row in `audit_logs` to debug).
- `organization_members` count must be `≤ 1`. Inviting a second member is blocked
  at the API layer with a `403 Forbidden` and a `tier_limit_exceeded` code.
- `knowledge_documents` count must be `≤ 5`. The 6th upload returns 402.
- Conversation quota enforced in `InboundMessageService.processInbound` *before*
  step 5 (insert message) — see §3 for the SQL and the service touchpoint.

### 2.2 Growth — $99 / 1,000 conversations / mo, then $0.10 / conversation

**Rationale.** This is the *primary commercial tier*. Most of our design-partner
candidates sit here: 5-25 person companies, 200-1500 conversations/month, 2+ channels,
"we need the AI to actually reply, not just draft." The $99 entry price is below the
decision threshold for a manager-level buyer (no procurement, no legal review for
$99/mo). The 1,000-conversation cap covers 90%+ of Growth-shaped customers without
overage; the 10% who exceed it pay $0.10 each and *thank* us because the alternative
(Front at $65/user × 5 seats = $325/mo *before* AI add-on, or Intercom at $74/seat
with Fin at $0.99/resolution) is dramatically more expensive at the same volume.

**What this tier IS.**
- Multi-seat (5). Owner + 4 agents, mix of roles.
- Multi-channel (SMS **and** email in the same org, same inbox).
- AI auto-reply enabled. The owner sets a per-tenant confidence threshold; the AI
  sends when `confidence ≥ threshold` and drafts (does not send) otherwise. This
  is the same threshold field that already exists in `ai_settings.confidence_threshold`,
  so the gating reuses existing infrastructure.
- 50 docs. Enough for a real KB: a product manual, a pricing page, an FAQ, a few
  how-tos, a couple of policies. Not "unlimited" — that signal belongs to Scale.

**What this tier is NOT.**
- Not enterprise. No SSO, no custom DPA terms, no dedicated CSM, no audit log export,
  no custom escalation keywords. The answer to "we need X for compliance" at this tier
  is "Scale."
- Not seat-unlimited. 6+ people is a different conversation; it almost always
  correlates with the audit/export/compliance needs of Scale.
- Not KB-unlimited. Knowledge rot is a real cost — we want to push people off the
  "throw everything in" pattern at 50 docs and onto a curation practice at Scale.

**Code-enforced boundaries.**
- `ai_settings.ai_mode` may be `draft_only` or `auto_reply`. The upgrade from
  Starter to Growth unlocks the `auto_reply` setter; nothing else changes.
- Seat cap `≤ 5` (members across `owner`/`admin`/`agent`/`viewer`).
- KB cap `≤ 50 documents`.
- Conversation quota `≤ 1,000` included; overage billed at $0.10/conversation, metered
  via the same quota counter as Starter.

### 2.3 Scale — $499 / 10,000 conversations / mo, then $0.05 / conversation

**Rationale.** This is the design-partner tier. It's priced for the buyer who
outgrew Growth (typical pattern: signed up at $99, hit the 1,000-conversation
cap after ~60 days of growth, *that's* the conversation that leads to
Scale — the exact timeline is an open question for design-partner research
see §6.1, §6.3). The $499 entry is the next procurement-threshold step (still below most
mid-market approval limits) and the unit economics at 10,000 conversations/month are
*better* than Growth (lower overage rate, higher margin) because we get volume
predictability.

The "design-partner tier" framing matters: we are *deliberately* using Scale to fund
the design partnership. In exchange for the higher entry price, Scale gets three
things Growth does not — custom escalation keywords, audit log export, and unlimited
seats/docs — because those are the three things design partners have asked us for in
pre-launch calls.

**What this tier IS.**
- The whole platform: unlimited seats, unlimited docs, SMS + email, AI auto-reply.
- **Custom escalation keywords.** A Scale admin can add their own triggers
  (e.g. a hospital adds "chest pain", a bank adds "wire transfer") via
  `ai_settings.escalation_keywords`, which the `KeywordRule` already consults
  (see `packages/support-core/src/services/escalation-rules.ts`). Growth inherits
  the *default* keyword list only.
- **Audit log export.** A Scale admin can request a CSV or JSON of the last 90
  days of `audit_logs` for their org via a new serverless function. The export
  itself is an async job (so it doesn't tie up a worker); the user gets a signed
  download URL when ready.
- An SLA-backed 24-hour response on Tier-2 support escalations (see
  `SUPPORT_PLAYBOOK.md` §"Tier 2 → 3" — the playbook already names the on-call
  engineer; Scale just buys the response window, not a different engineer).

**What this tier is NOT.**
- Not "white-glove." No dedicated CSM, no quarterly business reviews, no named
  on-call rotation. The next tier above Scale (post-v1) would be Enterprise and
  would carry those things; for v1, Scale is the top.
- Not "AI fine-tuning." We use the model's defaults. A Scale customer who wants
  model fine-tuning or a custom system prompt at a per-tenant level can already
  do that today via `ai_settings.system_prompt` (a column that exists today) —
  this is not a Scale gate, it's a per-tenant toggle available on every tier.
- Not an SLA on AI accuracy. We do not promise the AI's reply is right; the
  escalation engine, the confidence threshold, and the audit log exist *because*
  we don't.

**Code-enforced boundaries.**
- `ai_settings.escalation_keywords` write is permitted (blocked on Starter/Growth
  by the API layer).
- A new `GET /functions/v1/export-audit-log` serverless function exists; it
  checks the org's subscription tier and 402s if not Scale.
- The seat-cap and KB-cap checks in the service layer short-circuit to "allow"
  when the org's tier is Scale (i.e. they become no-ops, not "999999" sentinels).

---

## 3. Gating mechanism (the schema and the service touchpoint)

### 3.1 New table: `organization_subscriptions`

This is the *recommended* approach. The two alternatives I considered and rejected:

| Option | Why I'm not doing it |
|---|---|
| **Extend `ai_settings`** with `tier`, `conversation_quota`, `quota_period_start` | Conflates "what the AI does" (mode, threshold, model) with "what the customer paid for" (tier, quota, billing state). When we add a "pause AI for maintenance" feature that writes to `ai_settings`, we don't want it to step on billing data, and vice versa. |
| **Use `organizations.metadata` (the seed already does this with `"plan": "pro"`)** | The seed's `"plan": "pro"` is a placeholder; it's not enforceable. We can't `CHECK` a JSONB key, we can't run a `SELECT … WHERE tier = 'scale'`, and we can't hook Stripe webhooks to it. This is fine for v0; it's a blocker the day we send the first invoice. |

```sql
-- 004_organization_subscriptions.sql (DRAFT — for the build card to refine)
-- One row per organization. Created lazily on first tier assignment (INSERT … ON CONFLICT).
-- The Stripe-related columns are nullable so this table works in local-dev and self-hosted
-- deployments that never wire Stripe.

CREATE TABLE organization_subscriptions (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid        NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  tier                        text        NOT NULL DEFAULT 'starter'
                              CHECK (tier IN ('starter', 'growth', 'scale')),
  status                      text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'trialing', 'past_due', 'cancelled', 'paused')),
  conversation_quota          integer     NOT NULL DEFAULT 50,   -- tier default; can be overridden (e.g. design-partner comp)
  conversations_used          integer     NOT NULL DEFAULT 0,
  quota_period_start          timestamptz NOT NULL DEFAULT date_trunc('month', now()),
  stripe_customer_id          text,                              -- nullable: no Stripe in local dev
  stripe_subscription_id      text,                              -- nullable
  trial_ends_at               timestamptz,                       -- nullable
  current_period_end          timestamptz,                       -- nullable; set by Stripe webhook
  cancel_at_period_end        boolean     NOT NULL DEFAULT false,
  cancelled_at                timestamptz,                       -- nullable
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_org_subs_org_id ON organization_subscriptions (organization_id);
CREATE INDEX idx_org_subs_status ON organization_subscriptions (status)
  WHERE status IN ('active', 'trialing', 'past_due');

-- RLS: same pattern as organizations — org members can SELECT their own row;
-- INSERT/UPDATE/DELETE go through the service layer with a service-role key
-- (Stripe webhooks do not carry a user JWT).
ALTER TABLE organization_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_subs_select ON organization_subscriptions
  FOR SELECT USING (organization_id IN (SELECT user_org_ids()));

-- INSERT/UPDATE/DELETE intentionally have no policy for the `authenticated` role.
-- All writes go through `lib/subscriptions.ts` (service-role) so a client can never
-- self-upgrade. This matches how `audit_logs` is append-only.

-- Lazy-create a Starter row the first time we touch subscriptions for an org.
-- Called from the org-create flow OR the first InboundMessageService.processInbound
-- if the row is missing.
```

**Default quota by tier** (this lives in app code, not in the table, so a comp
override is one column update, not a schema change):

| Tier | `tier` | `conversation_quota` |
|---|---|---|
| Starter | `starter` | 50 |
| Growth | `growth` | 1,000 |
| Scale | `scale` | 10,000 |

### 3.2 Enforcement touchpoint in `InboundMessageService`

Today, `InboundMessageService.processInbound` (see
`packages/support-core/src/services/inbound-message-service.ts`) does 9 steps
in order. We add a **step 1.5** that runs *before* the duplicate check
(so a duplicate doesn't bypass the quota) and *before* the message insert
(so we never write a message we can't bill for):

```
1.  Check duplicate by (provider, externalMessageId)        ─┐
1.5 LOAD organization_subscriptions for orgId.                 │ NEW
    IF missing → lazy-create with tier='starter', quota=50,   │
       period_start=date_trunc('month', now()), used=0.       │
    RESET used=0 IF now() >= quota_period_start + 1 month.    │
    IF used >= quota:                                        ─┘
       - DO NOT insert message.
       - Insert a `rejected_inbound` row in audit_logs
         (action='inbound_rejected_quota', resource_id=orgId,
          metadata={tier, used, quota, period_start}).
       - Return a typed error: QuotaExceededError.
         The webhook function entrypoint maps this to a 402-style
         response. (Whether the provider retries on 402 is
         provider-specific — Twilio retries 4xx for ~15 minutes;
         Postmark logs and moves on. The point is that we *log*
         the rejection to `audit_logs` and *do not silently drop*
         the message; the customer's CSM notices the noisy
         `rejected_inbound` count in `docs/METRICS.md` and acts.)
2.  Normalize contact identifier.
3.  Find or create contact.
4.  Find or create conversation.
5.  Insert message.
6.  Update conversation lastMessageAt.
7.  Enqueue process_ai_message job.
8.  Record audit log.
9.  Return created message.
```

**On overage (Growth/Scale, not Starter).** Starter is a hard stop. For
Growth/Scale, the quota is the *included* allowance; the overage rate
($0.10 / $0.05 per conversation) is metered by a separate cron that, at
end-of-period, copies `conversations_used - conversation_quota` to
`stripe_usage_records` for the Stripe metered-billing API. The
InboundMessageService itself does not care about overage — it cares
about whether `conversations_used >= conversation_quota`, and the answer
is "yes, hard-stop" for Starter, "yes, no — allow and bill" for
Growth/Scale. The differentiation lives in one boolean:

```ts
// Pseudocode for the new step 1.5
const sub = await subscriptionRepo.getOrCreateStarter(orgId);
if (now() >= sub.quotaPeriodStart + 1 month) {
  sub = await subscriptionRepo.resetPeriod(orgId); // used=0, period=now()
}
const allowOverage = sub.tier !== 'starter';
const wouldExceed = sub.conversationsUsed + 1 > sub.conversationQuota;
if (wouldExceed && !allowOverage) {
  await auditLog.create({ orgId, action: 'inbound_rejected_quota', … });
  throw new QuotaExceededError({ tier: sub.tier, used: sub.conversationsUsed, quota: sub.conversationQuota });
}
// ...continue with step 2+; on success, increment conversations_used.
```

### 3.3 Why enforcement is in the service, not in an RLS policy

We considered a Postgres trigger on `INSERT INTO messages` that checks the quota
and aborts. We chose the service layer for three reasons:

1. **The trigger would fire on *every* message insert, including outbound.** A
   retry of an outbound `sms` from a human agent shouldn't count toward the
   inbound quota. The service-layer check on `processInbound` is naturally
   inbound-only.
2. **The trigger can't lazily create a subscription row without a service-role
   key — which would mean giving the trigger superuser.** The service layer
   already has the right credentials.
3. **A trigger error becomes a 500 with a `raise_exception`.** A typed
   `QuotaExceededError` becomes a 402 with a JSON body the webhook function
   can log and the provider can retry. That distinction matters when a
   customer asks "why did you drop my message?".

### 3.4 The other three checks

| Boundary | Where it lives | Where to read this in code |
|---|---|---|
| **AI auto-reply mode forced to `draft_only` on Starter** | `lib/ai-settings.ts` setter; refuses `ai_mode='auto_reply'` if `subscription.tier === 'starter'` | `packages/support-core/src/services/ai-agent-service.ts` (the `aiMode` read) |
| **Seat cap (1 / 5 / unlimited)** | New `SeatCapService.checkCanInvite(orgId, newRole)` called from `organization_members` POST | `packages/support-core/src/services/organization-service.ts` |
| **KB cap (5 / 50 / unlimited)** | New `KbCapService.checkCanUpload(orgId)` called from `knowledge_documents` POST | `packages/support-core/src/services/knowledge-ingestion-service.ts` |
| **Custom escalation keywords (Scale only)** | `ai_settings.escalation_keywords` setter; refuses non-empty array if `tier !== 'scale'` | `packages/support-core/src/services/ai-agent-service.ts` (read) and the `KeywordRule` in `escalation-rules.ts` (consume) |
| **Audit log export (Scale only)** | New `GET /functions/v1/export-audit-log`; checks tier, else 402 | new serverless function entrypoint |

---

## 4. Pricing signals to surface on the pricing page

The pricing page should ask exactly 4 questions and feed the answers into the
quota and capability checks above. These map 1:1 to the code-enforced boundaries,
which is the test that a signal is "real" and not "marketing fluff."

| # | Question | What we compute | What the page shows |
|---|---|---|---|
| 1 | "How many inbound conversations per month?" | pick the tier whose `conversation_quota` is the smallest ≥ the answer, else show the next tier with overage | "50 / 1,000 / 10,000 / custom" |
| 2 | "How many seats?" | if answer > 5, force Scale; if answer > 1 and < 5, force Growth | "1 / 5 / unlimited" |
| 3 | "AI auto-reply on or off?" | if "on", force Growth or Scale (Starter is draft-only) | "Drafts only (Starter) / Auto-reply (Growth+)" |
| 4 | "Need audit log export or custom escalation keywords?" | if "yes", force Scale | "Scale only" |

**The pricing-page CTA** posts to a `beta_signups` table (per
`LAUNCH_CHECKLIST.md` §7.2). For the v1 page, the CTA is "Request design-partner
access," not "Buy now" — we are not taking money yet.

---

## 5. Design-partner profiles (3 sketched, real-ish, not invented)

These are *personas* the sales motion will use to anchor design-partner
conversations. They are deliberately grounded in the seed data and the
AI-safety posture in `SUPPORT_PLAYBOOK.md`. **None of the company names
are real; the column values are plausible for the segment.**

### Profile 1 — "B2B SaaS, 12-person, 600 conversations / month"

| Field | Value |
|---|---|
| **Vertical** | B2B SaaS (project-management tool, like Linear or Height) |
| **Headcount** | 12 total · 1 support lead + 3 support agents + 8 engineering / GTM |
| **Current support volume** | ~600 inbound conversations / month · 70% email, 30% SMS (their customers are mobile-first SMBs who refuse to log in to a help portal) |
| **Current spend on alternatives** | Front at $65/user × 4 seats = **$260/mo** + a $200/mo Zapier bill to glue Front to Linear to a custom GPT-4 prompt for "draft a reply from the last 50 tickets" · ≈ **$5,500/yr** total |
| **Pain they articulate** | "We built a GPT-4 reply-drafter in-house. It hallucinates 1-in-20 times. Our CSAT dropped 8 points last quarter. We want the *idea* of AI drafting, but with a safety net (the 8 escalation rules) we don't have time to build." |
| **Tier fit** | **Growth** ($99/mo + ~$0 overage expected, since 600 < 1000). Their first 3 months of design-partnership are essentially free to us and worth 10× in feedback. |
| **Why they're a good design partner** | They will *immediately* push the `confidence_threshold` knob. They will discover that `0.75` is wrong for their domain within a week. They are exactly the customer who will tell us whether the auto-reply gate is "good enough" or "we need webhook/CRM integrations in Starter" (see open question 1). |

### Profile 2 — "Direct-to-consumer e-commerce, 4-person, 4,500 conversations / month"

| Field | Value |
|---|---|
| **Vertical** | DTC e-commerce (skincare / supplements, Instagram-first brand) |
| **Headcount** | 4 total · 1 owner + 2 part-time CSAs + 1 ops |
| **Current support volume** | ~4,500 inbound / month · 90% SMS ("where is my order?"), 10% email (returns / wholesale) |
| **Current spend on alternatives** | Gorgias at $60/mo Basic → too limited; **$300/mo Advanced** + a $99/mo Postscript add-on for SMS · ≈ **$4,800/yr**; *plus* a Gorgias "AI Agent" add-on at $0.60/resolution that they have stopped using because it gets refunds wrong |
| **Pain they articulate** | "Order-status questions are 60% of our volume. We need a draft that says 'your order shipped yesterday, tracking link is X' for the 50 questions/day that are basically the same question with a different order number. We don't trust any AI to actually press send on a *refund* — that's where we escalate to a human." |
| **Tier fit** | **Scale** ($499/mo + $0.05 × ~500 overage = **~$525/mo**, ≈ $6,300/yr). Slightly *more* expensive than Gorgias, but the AI-safety posture (8 deterministic rules) is the actual sell — the buyer is buying *not getting burned by AI again*. |
| **Why they're a good design partner** | They will be our stress test for the *refund* / *chargeback* / *legal-threat* escalation rules. They will also generate the most data for the `cost-per-conversation` metric in `LAUNCH_CHECKLIST.md` §4.3. |

### Profile 3 — "Regional services firm, 30-person, 1,800 conversations / month"

| Field | Value |
|---|---|
| **Vertical** | Regional property-management firm (apartment rentals, 12 properties) |
| **Headcount** | 30 total · 1 ops director + 6 property managers + 23 maintenance / leasing · support is split: maintenance tickets (in-house portal) vs. prospect/resident SMS (front desk) |
| **Current support volume** | ~1,800 inbound SMS / month (prospective tenants asking about availability, current residents about maintenance) + ~200 emails / month |
| **Current spend on alternatives** | A shared Google Voice number (free, but messages get lost), a part-time VA at $18/hr × 20 hr/wk = **$1,440/mo** · **$17,280/yr** |
| **Pain they articulate** | "We lose 3-4 prospective tenants a week because nobody answered their SMS within 30 minutes. We can't afford to staff a 24/7 desk. We need the AI to answer 'is 2BR available in May?' with the actual availability, and escalate 'my heat is out' to a human immediately." |
| **Tier fit** | **Growth** ($99/mo) for the first 6 months, then almost certainly **Scale** as they wire maintenance-ticket creation via a webhook. |
| **Why they're a good design partner** | They are the test for **multi-tenant industry jargon** ("2BR", "Section 8", "lease break") in the knowledge base. They will tell us if `ai_settings.knowledge_similarity_threshold = 0.70` is too tight (it almost certainly is for real-estate). |

### (Bonus) Profile 4 — "Solo founder, 1-person, 30 conversations / month"

The **Starter** customer. A Shopify merchant doing 30 inbound/week. They will
never become a design partner. They are the long-tail the free tier exists to
capture. The design-partner program is not optimized for them; the *pricing
page* is — if the page can convert a Profile 4 to a Starter signup without a
sales call, the funnel is healthy.

---

## 6. Open questions — must answer with data

These are the questions we cannot answer in this document. Each requires a
design-partner conversation (and ideally a `usability test` or a `win/loss`
analysis) before we change a price, a boundary, or a tier name. They are
*not* nice-to-haves; they are the things that will tell us if this hypothesis
is wrong.

### Q1. Is "AI auto-reply on Growth+" enough of a hook, or do we need webhook/CRM integrations in Starter?

**Why this matters.** The Starter → Growth conversion is the only place we
make money on a free-tier user. The current bet is that the auto-reply
threshold is the lever. But Profile 1 (the SaaS founder) might say *"I
don't care about auto-reply, I just want my AI drafts to push to Linear
automatically."* If 3 of 5 design partners say that, then the Starter →
Growth conversion lever is wrong, and we should add a webhook/CRM export
to Starter instead (and probably move the auto-reply unlock to Scale).

**How we'd learn it.** In the first 5 design-partner calls, ask: *"If you
had to pick one feature to unlock, what's the one that makes Growth
worth $99/mo to you?"* Tally. If "auto-reply" is <2 of 5, we revisit.

**Decision deadline.** After call #5 (target: end of week 4 of beta).

### Q2. Is $99/mo a real price for Growth, or is it a vanity round number?

**Why this matters.** $99 sits just below most mid-market procurement
thresholds ($100/seat-month is a common review line). $129 is a 30% lift
in ARR per customer and *still* below the threshold. $79 is a 20% cut
that may double conversion. We have no data on which side of this
tradeoff we should be on.

**How we'd learn it.** A/B the pricing page in week 6+ of beta
(Starter is always $0; Growth is $79 / $99 / $129 randomized by
visitor-cookie). Measure signup → activated (defined as "received
first inbound and AI drafted first reply") conversion per arm.

**Decision deadline.** After ~200 signups per arm (target: end of
week 8 of beta).

### Q3. Is the 50-conversation Starter quota a feature or a bug?

**Why this matters.** If Starter is *too* generous (real solo founders
get 30/week and never upgrade), the funnel leaks. If it's *too* tight
(a 4-person Shopify store doing 80 conversations/week hits the wall
on day 3 and churns), the funnel leaks the other way. 50 is a guess
based on the seed data shape.

**How we'd learn it.** After 30 days, pull `conversations_used` for
all Starter orgs. If the median is < 10, the quota is too generous
(consider 25). If the median is > 45 and the upgrade-to-Growth rate
is < 5%, the quota is too tight (consider 100). If the median is
20-35, the quota is right.

**Decision deadline.** After 30 days of Starter production data.

### Q4. (Bonus) What does "audit log export" mean to a Scale customer?

**Why this matters.** I asserted that "CSV / JSON, last 90 days" is
the right shape. That is a guess based on G2 reviews of Intercom and
Zendesk. A Scale customer's compliance team might want "JSONL
streaming over a year, signed, with field-level encryption." We
don't know yet.

**How we'd learn it.** In the first 2 Scale design-partner calls,
ask: *"If we gave you an export button, what would you do with the
file?"* If the answer is "give it to our auditor," the shape is
PDF + signed. If the answer is "load it into Splunk," the shape is
JSONL over a year.

**Decision deadline.** Before we build the export function
(separate card; depends on the answer).

---

## 7. Out of scope (explicit)

- **Final prices.** The dollar amounts in this document are placeholders.
  They get set after Q1, Q2, and Q3 are answered with data.
- **Stripe wiring.** The `organization_subscriptions` table has the
  `stripe_*` columns sketched, but the build of the Stripe webhook
  handler and the metering of overage is a separate card. This card
  only designs the schema, the service touchpoint, and the boundary
  rules.
- **A pricing page UI.** This document is the *hypothesis*; the
  page is a separate card (`t_pm_launch_checklist` §7.1). The 4
  pricing signals in §4 are the input the page implements, not the
  page itself.
- **Enterprise tier (>$499/mo).** Post-v1.
- **Per-seat pricing.** Not in the v1 hypothesis. The seat caps
  (1/5/unlimited) are tier gates, not a separate axis. If design
  partners push for per-seat, we revisit in v1.1.

---

## 8. Cross-references

- **PRD (requirements source of truth):** `.kiro/specs/ai-customer-support/requirements.md` (Req 2 "Organization Management" covers seat/role; Req 11 "AI Agent Decision Engine" covers `ai_settings.ai_mode`; Req 12 "Escalation Rules" covers the keyword list)
- **Architecture:** `docs/ARCHITECTURE.md` (the `InboundMessageService` flow described here is the same flow documented there)
- **Database / RLS:** `docs/DATABASE.md` (the 17 tables; `organization_subscriptions` will be the 18th, in a new migration `004_organization_subscriptions.sql`)
- **Escalation rules (the 8):** `packages/support-core/src/services/escalation-rules.ts` (the `KeywordRule` is what the Scale-only "custom escalation keywords" boundary unlocks)
- **Support playbook:** `docs/SUPPORT_PLAYBOOK.md` (the Tier 1 → 2 → 3 escalation path; Scale buys a 24-hour Tier-2 response window)
- **Launch checklist (this doc feeds §7):** `docs/LAUNCH_CHECKLIST.md`
- **DPA / AUP / legal:** `legal/README.md`, `legal/DPA.md`, `legal/AUP.md` (every tier signs the same DPA; the AUP applies uniformly)
- **Sibling pricing/GTM cards:**
  - `t_pm_beta_program` — design-partner cohort (this doc profiles 3 of the 5 we need to name)
  - `t_pm_competitive` — competitive landscape (Front, Intercom, Ada, Gorgias — the names Profile 1, 2, 3 use as their "current spend"). See `docs/COMPETITIVE.md` for the 5 one-pagers, the 2-axis positioning map, and the "We will NOT compete on" anti-PRD.
  - `t_ops_support_handoff` — Tier-1 support playbook (Scale's 24h SLA is the only tier-specific support commitment)

---

## 9. Acceptance check (self-review)

- [x] `docs/PRICING.md` exists with 3 tiers, a rationale paragraph for each, and a "what this tier is NOT" line. (§1, §2.1, §2.2, §2.3)
- [x] A draft SQL sketch for `organization_subscriptions` (the new table approach), with the alternative I considered and rejected (extending `ai_settings`) named explicitly. (§3.1)
- [x] At least 3 design-partner profiles sketched (4, actually, including a Profile 4 to represent the Starter long-tail). (§5)
- [x] At least 2 open questions marked "must answer with data" (3, plus a bonus on audit-log-export shape). (§6)
- [x] Linked from LAUNCH_CHECKLIST.md (the sibling `t_pm_pricing_packaging` row in the "Child Kanban cards" section of `LAUNCH_CHECKLIST.md` already names this doc). The PRD does not exist as a single file (it lives at `.kiro/specs/ai-customer-support/requirements.md`); the cross-reference in §8 points to the requirements file by its actual path.
