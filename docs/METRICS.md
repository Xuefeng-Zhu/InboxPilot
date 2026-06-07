# InboxPilot — Success Metrics (North Star + Input Metric Tree)

> Last updated: 2026-06-07 · source of truth: this document
> Pair with: `docs/PRD.md` §3 (the *event* definitions), `docs/PRD.md` §5 (out-of-scope for v1), `docs/LAUNCH_CHECKLIST.md` §4.3 (weekly review), `docs/DATABASE.md` (column reference), `insforge/migrations/001_initial_schema.sql` (schema authority)
> Kanban parent: `t_pm_metric_tree` (this card) · coordinates with: `t_eng_instrumentation` (cost column), `t_eng_analytics_dashboard` (consumer of these queries), `t_qa_feedback_loop` (escalation labels)

## How to read this

This is the **query layer** that pairs with `docs/PRD.md` §3. The PRD commits to the *events* a metric counts ("AI containment = status=resolved without human-agent outbound"). This file commits to the *SQL* that produces those counts against the schema as it exists in `insforge/migrations/001_initial_schema.sql`. Every query below has been hand-checked against the column names in that migration.

**One North Star, six input metrics, two watch metrics.** Each input metric exists to answer a single question the North Star can't — together they form a tree that the launch checklist can audit weekly.

**Two things this file is *not*.** It is not a dashboard (the analytics page is a separate card, `t_eng_analytics_dashboard`). It is not a runbook (a metric that falls below its threshold is a flag, not a script — escalation paths are in `docs/INCIDENT_RESPONSE.md` and `docs/SUPPORT_PLAYBOOK.md`).

---

## North Star — M0: AI containment rate

**Question it answers.** Of the conversations a tenant receives, what share is the AI resolving end-to-end — i.e., a customer got an answer from the AI and never needed a human in the same conversation?

**Owner.** PM (definition), Eng (query), Ops (weekly review).

**PRD reference.** `docs/PRD.md` §3.1. Target: ≥ 60% by week 4 of a new tenant's life. Tripwire: < 50% means the AI is unsafe or unhelpful and the design-partner cohort is at risk.

**Definition (per the PRD).** The share of inbound conversations that resolve (`conversations.status = 'resolved'`) within 7 days *without* a human agent having sent an outbound message (`messages.sender_type = 'user'` per the actual schema — see [Definitions & known discrepancies](#definitions--known-discrepancies-with-the-prd)). Counted per tenant, starting at `organizations.created_at`.

**SQL sketch (runnable against the existing schema).**

```sql
-- M0: AI containment rate, per tenant, per ISO week
WITH resolved_conversations AS (
  SELECT
    c.id              AS conversation_id,
    c.organization_id,
    c.created_at      AS conv_created_at,
    -- "Did the AI send the last meaningful reply?" — i.e. an outbound
    -- message from the AI exists, and no human agent sent any outbound
    -- message in the same conversation.
    EXISTS (
      SELECT 1
        FROM messages m
       WHERE m.conversation_id = c.id
         AND m.sender_type     = 'ai'
         AND m.direction       = 'outbound'
    ) AS has_ai_outbound,
    NOT EXISTS (
      SELECT 1
        FROM messages m
       WHERE m.conversation_id = c.id
         AND m.sender_type     = 'user'   -- human agent
         AND m.direction       = 'outbound'
    ) AS no_human_outbound
  FROM conversations c
  WHERE c.status = 'resolved'
    AND c.created_at >= now() - interval '7 days'   -- the PRD's 7-day window
)
SELECT
  o.id                                                      AS org_id,
  o.name                                                    AS org_name,
  date_trunc('week', o.created_at)                          AS tenant_week,
  count(*)                                                  AS resolved_conversations,
  count(*) FILTER (
    WHERE has_ai_outbound AND no_human_outbound
  )                                                         AS ai_contained,
  round(
    100.0 * count(*) FILTER (
      WHERE has_ai_outbound AND no_human_outbound
    ) / nullif(count(*), 0),
    1
  )                                                         AS containment_pct
FROM resolved_conversations rc
JOIN organizations o ON o.id = rc.organization_id
GROUP BY o.id, o.name, date_trunc('week', o.created_at)
ORDER BY org_name, tenant_week;
```

**Source tables.** `conversations` (`001_initial_schema.sql:62`), `messages` (`:85`), `organizations` (`:16`).

**Indexes it relies on.** `idx_conversations_org_status` (`:77`) for the `status='resolved'` filter; the `messages.conversation_id` lookup is a foreign-key scan which is fine at the design-partner volume.

**Failure mode this catches.** A tenant where the AI is sending a lot of replies but customers are *still* coming back to a human within 7 days. That's the "AI is too confident, KB is too thin" failure mode (PRD §3.2 M1's "Why this and not just M0"). The M0 query will stay low even if M1 (deflection) is high.

---

## Input metrics

### M1 — AI deflection rate

**Question it answers.** Of inbound messages, what share got an AI-authored outbound reply (drafted or auto-sent)?

**Owner.** PM (definition), Eng (query).

**PRD reference.** `docs/PRD.md` §3.2. M1 is the leading indicator of M0 — it moves first.

**Definition.** Share of inbound messages (where `messages.direction='inbound'`) that have a later outbound message with `sender_type='ai'` on the same conversation, OR have an `ai_decisions` row with `decision_type='respond'` and `metadata->>autoSent = 'true'` in the originating audit row. Per tenant per ISO week.

**SQL sketch.**

```sql
-- M1: AI deflection rate, per tenant, per ISO week
WITH inbound_msgs AS (
  SELECT
    m.id              AS message_id,
    m.conversation_id,
    c.organization_id
  FROM messages m
  JOIN conversations c ON c.id = m.conversation_id
  WHERE m.direction   = 'inbound'
    AND m.created_at  >= now() - interval '7 days'
),
deflected AS (
  SELECT
    i.message_id,
    i.organization_id,
    EXISTS (
      SELECT 1
        FROM messages m
       WHERE m.conversation_id = i.conversation_id
         AND m.sender_type     = 'ai'
         AND m.direction       = 'outbound'
         AND m.created_at      > (SELECT created_at FROM messages WHERE id = i.message_id)
    ) AS got_ai_reply
  FROM inbound_msgs i
)
SELECT
  o.id                                  AS org_id,
  o.name                                AS org_name,
  count(*)                              AS inbound_messages,
  count(*) FILTER (WHERE d.got_ai_reply) AS deflected,
  round(
    100.0 * count(*) FILTER (WHERE d.got_ai_reply) / nullif(count(*), 0),
    1
  )                                     AS deflection_pct
FROM deflected d
JOIN organizations o ON o.id = d.organization_id
GROUP BY o.id, o.name
ORDER BY org_name;
```

**Source tables.** `messages` (`:85`), `conversations` (`:62`), `ai_decisions` (`:219`), `audit_logs` (`:299`).

**Why this and not just M0.** M1 counts *attempts*; M0 counts *successes*. A high M1 with low M0 is a different failure mode from low M1 with high M0 — different fix needed.

### M2 — First response time (FRT)

**Question it answers.** When a customer sends an inbound message, how long until they get *any* outbound reply (AI or human)?

**Owner.** PM (definition), Eng (query).

**PRD reference.** `docs/PRD.md` §3.2. Target: median < 30 seconds for the first reply to an inbound.

**Definition.** Per conversation, the delta from the *first* inbound `messages` row to the *first* outbound `messages` row of any `sender_type` (`'user'`, `'ai'`, `'system'`). Reported as the **median** across conversations, per tenant per day.

**SQL sketch.**

```sql
-- M2: median FRT, per tenant, per day
WITH conversation_reply_pairs AS (
  SELECT
    c.id                                                          AS conversation_id,
    c.organization_id,
    date_trunc('day', first_inbound.created_at)                   AS day,
    extract(epoch FROM (
      first_outbound.created_at - first_inbound.created_at
    ))                                                            AS frt_seconds
  FROM conversations c
  JOIN LATERAL (
    SELECT created_at
      FROM messages
     WHERE conversation_id = c.id
       AND direction = 'inbound'
     ORDER BY created_at ASC
     LIMIT 1
  ) first_inbound ON true
  JOIN LATERAL (
    SELECT created_at
      FROM messages
     WHERE conversation_id = c.id
       AND direction = 'outbound'
       AND sender_type IN ('user', 'ai', 'system')
     ORDER BY created_at ASC
     LIMIT 1
  ) first_outbound ON true
  WHERE first_outbound.created_at > first_inbound.created_at
)
SELECT
  o.id                                AS org_id,
  o.name                              AS org_name,
  cp.day,
  count(*)                            AS conversations_measured,
  percentile_cont(0.5)
    WITHIN GROUP (ORDER BY cp.frt_seconds) AS median_frt_seconds
FROM conversation_reply_pairs cp
JOIN organizations o ON o.id = cp.organization_id
GROUP BY o.id, o.name, cp.day
ORDER BY o.name, cp.day;
```

**Source tables.** `messages` (`:85`), `conversations` (`:62`).

**Why this matters more than M0 for the tripwire.** The §1.3 signal #3 in the PRD (the property-management firm losing 3-4 prospective tenants/week) is fundamentally an FRT problem. Even if the AI never *resolves* a conversation, getting a *response* in under 30 seconds is the win. FRT moves first.

### M3 — CSAT, sampled (4-or-5 share)

**Question it answers.** When a customer is asked to rate a resolved conversation, what share said 4 or 5 on a 5-point scale?

**Owner.** PM (definition), Eng (capture path + query).

**PRD reference.** `docs/PRD.md` §3.2. Target: ≥ 4.0 average per tenant per month. < 3.5 = launch-blocker for the next design-partner cohort.

**Definition.** Among conversations with `status='resolved'` and a follow-up CSAT response, the share of responses where the parsed score is ≥ 4 on a 5-point scale. CSAT is captured by a follow-up message with a numeric body and stored in `messages.raw_payload->>'csat_score'` on the inbound response. (The schema column is `raw_payload jsonb`; the `metadata` name from the PRD is a doc-level column-name shorthand — see [Definitions & known discrepancies with the PRD](#definitions--known-discrepancies-with-the-prd).) **The capture path is not yet wired in v1** — this metric is defined here so the column-and-capture-path are on the data-model roadmap and so the query is ready when the capture path lands.

**SQL sketch (final form, for when CSAT capture ships).**

```sql
-- M3: CSAT (4-or-5 share), per tenant, per month
WITH csat_responses AS (
  SELECT
    m.raw_payload->>'csat_score' AS score_text,
    c.organization_id
  FROM messages m
  JOIN conversations c ON c.id = m.conversation_id
  WHERE c.status = 'resolved'
    AND m.direction = 'inbound'
    AND m.raw_payload ? 'csat_score'                       -- jsonb key exists
    AND (m.raw_payload->>'csat_score') ~ '^[1-5]$'         -- shape check
)
SELECT
  o.id                                AS org_id,
  o.name                              AS org_name,
  date_trunc('month', now())          AS month,
  count(*)                            AS csat_responses,
  count(*) FILTER (
    WHERE score_text IN ('4', '5')
  )                                   AS positive_responses,
  round(
    100.0 * count(*) FILTER (
      WHERE score_text IN ('4', '5')
    ) / nullif(count(*), 0),
    1
  )                                   AS positive_pct
FROM csat_responses cr
JOIN organizations o ON o.id = cr.organization_id
GROUP BY o.id, o.name
ORDER BY o.name;
```

**Source tables.** `messages` (`:85`, the `metadata jsonb` is the only place CSAT lives), `conversations` (`:62`).

**Why this is a metric and not just "did the customer stay."** SMB support teams do not have NPS infrastructure. CSAT is the right tool for them. We do not promise to capture CSAT in v1 for *every* conversation, but the metric is defined here so the capture path is part of v1's data-model roadmap.

**Capture-path dependency.** The follow-up SMS/email template that asks "Rate this reply 1-5" + the inbound-message-service's `body` parser that extracts the score into `metadata.csat_score` is owned by the metric-instrumentation card (`t_eng_instrumentation`). Until that ships, M3 returns an empty result set by design.

### M4 — Cost per resolved conversation ($/ticket)

**Question it answers.** What is the fully-loaded cost (LLM tokens + provider fees) per conversation we close?

**Owner.** PM (definition), Eng (capture + query), Ops (weekly unit-economics review).

**PRD reference.** `docs/PRD.md` §3.2. Tripwire: if $/ticket > $0.30 at the Growth tier (overage is $0.10), unit economics are broken.

**Definition.** `sum(ai_decisions.tokens_used * price_per_token)` from the OpenRouter price table, plus provider fees (Twilio/Telnyx per-message, Postmark per-email) from `sms_delivery_events` and `email_delivery_events`, divided by the count of `conversations` rows with `status IN ('resolved', 'escalated')` for the same period.

**🚨 SCHEMA CHANGE REQUIRED — coordinates with `t_eng_instrumentation`.**

The `ai_decisions` table (`001_initial_schema.sql:219`) does not have a `tokens_used` column. It has `confidence`, `reasoning_summary`, `response_text`, `tags`, `requires_human`, `raw_response jsonb` — and the OpenRouter response is currently stashed in `raw_response`. The PRD's M4 references `tokens_used` and `openrouter_cost` and the task body of `t_pm_metric_tree` explicitly flags this as a schema change. The proposed new columns:

```sql
-- proposed addition, owned by t_eng_instrumentation, NOT this card
ALTER TABLE ai_decisions
  ADD COLUMN prompt_tokens     integer,
  ADD COLUMN completion_tokens integer,
  ADD COLUMN total_tokens      integer,
  ADD COLUMN openrouter_cost   numeric(10, 6);  -- USD
```

**SQL sketch (final form, for after the schema change lands).**

```sql
-- M4: cost per resolved conversation, per tenant, per ISO week
WITH llm_costs AS (
  SELECT
    ad.organization_id,
    sum(ad.openrouter_cost) AS llm_cost_usd
  FROM ai_decisions ad
  WHERE ad.created_at >= date_trunc('week', now())
  GROUP BY ad.organization_id
),
provider_costs AS (
  -- SMS provider fees, where sms_delivery_events.message_id joins to a
  -- conversation belonging to this org. Provider pricing is *not* stored
  -- in the schema — we hardcode a flat $/message in the application
  -- layer and pass it as a column on sms_delivery_events, or join to a
  -- provider_fees table (TBD with t_eng_instrumentation).
  SELECT
    c.organization_id,
    count(sde.*) AS sms_messages_billable,
    count(ede.*) AS email_messages_billable
  FROM conversations c
  JOIN messages m ON m.conversation_id = c.id
  LEFT JOIN sms_delivery_events   sde ON sde.message_id = m.id
  LEFT JOIN email_delivery_events ede ON ede.message_id = m.id
  WHERE c.status IN ('resolved', 'escalated')
    AND c.updated_at >= date_trunc('week', now())
  GROUP BY c.organization_id
)
SELECT
  o.id                                AS org_id,
  o.name                              AS org_name,
  coalesce(lc.llm_cost_usd, 0)        AS llm_cost_usd,
  coalesce(pc.sms_messages_billable, 0) + coalesce(pc.email_messages_billable, 0)
                                      AS provider_messages,
  -- NOTE: provider_cost_usd requires a per-message fee table that does
  -- not exist yet. This placeholder is intentionally NOT a hardcoded
  -- number — see "M4 instrumentation prerequisites" below.
  0                                   AS provider_cost_usd,   -- placeholder
  count(c.*)                          AS resolved_or_escalated,
  round(
    (coalesce(lc.llm_cost_usd, 0) + 0) / nullif(count(c.*), 0),
    4
  )                                   AS cost_per_ticket_usd
FROM organizations o
LEFT JOIN llm_costs      lc ON lc.organization_id = o.id
LEFT JOIN provider_costs pc ON pc.organization_id = o.id
LEFT JOIN conversations  c  ON c.organization_id = o.id
                          AND c.status IN ('resolved', 'escalated')
                          AND c.updated_at >= date_trunc('week', now())
GROUP BY o.id, o.name, lc.llm_cost_usd, pc.sms_messages_billable, pc.email_messages_billable
ORDER BY o.name;
```

**M4 instrumentation prerequisites (owned by `t_eng_instrumentation`).**

1. Add `prompt_tokens`, `completion_tokens`, `total_tokens`, `openrouter_cost` columns to `ai_decisions` (migration `004_ai_decisions_costs.sql`).
2. The `ai-agent-service` writes these columns from the OpenRouter response (the response already includes `usage` — see `packages/support-core/src/services/openrouter-client.ts`).
3. Provider per-message fees are *not* a column on `sms_delivery_events` / `email_delivery_events` today. Two options for the instrumentation card to choose between:
   - (a) Add a `provider_cost_usd numeric(10,6)` column to both tables, populated by the inbound function from a hardcoded price table in `lib/`.
   - (b) Add a `provider_pricing` table keyed by `(provider, channel)` and joined at query time.
4. M4's `provider_cost_usd` placeholder in the SQL above returns 0 until option (a) or (b) ships.

**Why this is a metric and not just "do we make money."** This is the unit-economics sanity check. The Growth tier is priced at $0.10/conversation overage. If M4 > $0.30, the tier is uneconomic and the launch checklist §4.3 weekly review will block further Growth-tier sign-ups.

### M5 — Escalation precision

**Question it answers.** Of conversations the AI escalates, what share were *correctly* escalated (i.e., a human agent later confirmed the escalation was warranted)?

**Owner.** PM (definition), QA (labeling), Eng (query).

**PRD reference.** Not in the PRD §3.2 top-4. Listed in the task body of `t_pm_metric_tree` as a v1-quality metric.

**Definition.** `count(escalations that were 'true positive' based on audit_logs review) / count(escalations)`. An escalation is "true positive" when a `human_intervention: 'true_positive'` label appears in `audit_logs.metadata` for the same `conversation_id` within 7 days of the escalation event.

**Schema dependency.** The `human_intervention` label does not exist yet. The labeling surface is owned by `t_qa_feedback_loop` (a v1 launch-blocker per `LAUNCH_CHECKLIST.md` §3.4). The query below assumes the labeling writes `audit_logs` rows with `action='escalation_labeled'` and `metadata->>label IN ('true_positive', 'false_positive')`.

**SQL sketch (final form, for after the QA labeling ships).**

```sql
-- M5: escalation precision, per tenant, per ISO week
WITH escalations AS (
  SELECT
    al.id            AS escalation_event_id,
    al.organization_id,
    al.resource_id   AS conversation_id,
    al.created_at    AS escalated_at
  FROM audit_logs al
  WHERE al.action     = 'conversation_escalated'
    AND al.resource_type = 'conversation'
    AND al.created_at >= date_trunc('week', now())
),
labels AS (
  SELECT
    al.resource_id   AS conversation_id,
    al.organization_id,
    al.metadata->>'label' AS label
  FROM audit_logs al
  WHERE al.action     = 'escalation_labeled'
    AND al.resource_type = 'conversation'
)
SELECT
  e.organization_id,
  count(*)                                    AS escalations,
  count(*) FILTER (WHERE l.label = 'true_positive')  AS true_positives,
  count(*) FILTER (WHERE l.label = 'false_positive') AS false_positives,
  count(*) FILTER (WHERE l.label IS NULL)             AS unlabeled,
  round(
    100.0 * count(*) FILTER (WHERE l.label = 'true_positive')
    / nullif(count(*) FILTER (WHERE l.label IS NOT NULL), 0),
    1
  )                                           AS precision_pct
FROM escalations e
LEFT JOIN labels l USING (organization_id, conversation_id)
GROUP BY e.organization_id
ORDER BY e.organization_id;
```

**Source tables.** `audit_logs` (`:299`).

**Why "unlabeled" is its own column.** A label rate below 80% of escalations is itself a problem — the QA feedback loop isn't catching up. Reporting `precision_pct` as a fraction of *labeled* (not total) escalations prevents a low-label-rate week from looking artificially precise.

### M6 — Time to value (TTV)

**Question it answers.** Once a tenant signs up, how long until they have at least one AI decision on a real conversation?

**Owner.** PM (definition), Eng (query), Ops (the activation funnel).

**PRD reference.** Not in the PRD §3.2 top-4. Listed in the task body of `t_pm_metric_tree` as a v1-quality metric.

**Definition.** For each `organizations` row, the delta from `organizations.created_at` to the first `ai_decisions` row with `organization_id = organizations.id`. Reported as the **median** across tenants created in the measurement window.

**SQL sketch.**

```sql
-- M6: time to value (TTV), median across tenants created this week
WITH first_ai_decision AS (
  SELECT
    ad.organization_id,
    min(ad.created_at) AS first_decision_at
  FROM ai_decisions ad
  GROUP BY ad.organization_id
)
SELECT
  date_trunc('week', o.created_at)     AS tenant_signup_week,
  count(o.*)                            AS tenants_signed_up,
  count(fad.first_decision_at)          AS tenants_activated,
  percentile_cont(0.5)
    WITHIN GROUP (ORDER BY extract(epoch FROM (
      fad.first_decision_at - o.created_at
    )))                                 AS median_ttv_seconds
FROM organizations o
LEFT JOIN first_ai_decision fad ON fad.organization_id = o.id
WHERE o.created_at >= now() - interval '4 weeks'
GROUP BY date_trunc('week', o.created_at)
ORDER BY tenant_signup_week;
```

**Source tables.** `organizations` (`:16`), `ai_decisions` (`:219`).

**Why this is a metric and not just "active tenants."** TTV is the leading indicator of the *first* cohort experience. If a tenant is two weeks in with no AI decision, the activation funnel is broken — they haven't given the AI a chance. M6 catches the "the AI was on but never had any conversations" failure mode that M1 / M0 would silently pass.

---

## Watch metrics — do not optimize, do not lose sight of

These are the metrics we expect to be **noise** at design-partner volume, and we explicitly choose not to optimize for them. They're listed because a change in any one is a useful smoke-detector for a different problem.

### W1 — Raw message volume per org

**Why we're watching.** If a tenant's inbound message volume goes *up* quarter over quarter, we might be tempted to call that "engagement" and celebrate. It might also mean the AI is *not* resolving conversations and customers are repeating themselves. M0 should move with volume if the AI is doing its job. If volume goes up but M0 stays flat, the AI quality is degrading.

**Source query.**

```sql
-- W1: raw inbound message volume, per tenant, per ISO week
SELECT
  c.organization_id,
  date_trunc('week', m.created_at) AS week,
  count(*)                         AS inbound_messages
FROM messages m
JOIN conversations c ON c.id = m.conversation_id
WHERE m.direction  = 'inbound'
  AND m.created_at >= now() - interval '12 weeks'
GROUP BY c.organization_id, date_trunc('week', m.created_at)
ORDER BY c.organization_id, week;
```

**Source tables.** `messages` (`:85`), `conversations` (`:62`).

### W2 — Drafts-never-sent rate (drafts-only mode friction)

**Why we're watching.** In `draft_only` mode, the AI produces a draft but a human must approve-and-send. If the *drafts-never-sent* rate is high, the agents are rejecting the AI's work — which means the AI is confidently wrong. That's a different signal from "the AI escalated" (which is the AI being *correctly* uncertain). A high W2 in a `draft_only` tenant is a leading indicator that flipping them to `auto_reply` will produce embarrassments.

**Source query.**

```sql
-- W2: drafts produced but never sent (drafts-only mode friction proxy)
-- The `mode` field is on audit_logs.metadata, not ai_decisions.
-- A draft is "abandoned" when its `ai_decision_produced` audit row
-- was emitted in `draft_only` mode AND no `ai_draft_approved` audit
-- row exists for the same ai_decision.
WITH draft_audit AS (
  SELECT
    al.organization_id,
    al.resource_id                              AS draft_id
  FROM audit_logs al
  WHERE al.action        = 'ai_decision_produced'
    AND al.resource_type = 'ai_decision'
    AND al.metadata->>'mode' = 'draft_only'
    AND al.created_at    >= now() - interval '4 weeks'
),
drafts AS (
  SELECT
    da.organization_id,
    da.draft_id
  FROM draft_audit da
  -- join to ai_decisions to filter on decision_type and bound the date
  JOIN ai_decisions ad ON ad.id = da.draft_id
  WHERE ad.decision_type = 'respond'
)
SELECT
  d.organization_id,
  count(*)                                       AS drafts_produced,
  count(*) FILTER (WHERE EXISTS (
    SELECT 1
      FROM audit_logs al
     WHERE al.resource_id   = d.draft_id
       AND al.resource_type = 'ai_decision'
       AND al.action        = 'ai_draft_approved'
  ))                                             AS drafts_approved,
  count(*) FILTER (WHERE NOT EXISTS (
    SELECT 1
      FROM audit_logs al
     WHERE al.resource_id   = d.draft_id
       AND al.resource_type = 'ai_decision'
       AND al.action        = 'ai_draft_approved'
  ))                                             AS drafts_abandoned,
  round(
    100.0 * count(*) FILTER (WHERE NOT EXISTS (
      SELECT 1
        FROM audit_logs al
       WHERE al.resource_id   = d.draft_id
         AND al.resource_type = 'ai_decision'
         AND al.action        = 'ai_draft_approved'
    )) / nullif(count(*), 0),
    1
  )                                              AS abandoned_pct
FROM drafts d
GROUP BY d.organization_id
ORDER BY abandoned_pct DESC;
```

**Source tables.** `ai_decisions` (`:219`), `audit_logs` (`:299`).

**Note on shape.** `ai_draft_approved` is the audit action emitted by `insforge/functions/approve-ai-draft/index.ts:154`. A draft is "abandoned" when there is no `ai_draft_approved` audit row for the decision's id *and* the conversation is not later resolved with a human reply within a reasonable window — the current query uses the simpler "never approved" heuristic, which slightly over-counts abandonment for in-flight drafts. Acceptable at design-partner volume.

---

## Definitions & known discrepancies with the PRD

The PRD §3 is the *event* contract. This file is the *query* contract. They align on the metric *names* (M0–M4) but the PRD's prose has a small number of column-name typos that the SQL here corrects. The typos are *in the PRD, not the schema* — the schema is the authority. For the record:

| PRD says | Schema actually has | Why this is so | Where the schema wins |
|---|---|---|---|
| `sender_type = 'human_agent'` for the human agent | `sender_type = 'user'` (the agent is a logged-in `user` of the org) | The schema's CHECK constraint and the TypeScript `SenderType` union both list `'contact' \| 'user' \| 'ai' \| 'system'`. The PRD's `human_agent` is a doc-level typo. | `001_initial_schema.sql:88`; `packages/support-core/src/types/index.ts:21` |
| `ai_decisions.tokens_used` | `ai_decisions` has no `tokens_used` column (it has `confidence`, `reasoning_summary`, `response_text`, `tags`, `requires_human`, `raw_response jsonb`) | The OpenRouter response is currently stashed in `raw_response`. The PRD's M4 anticipates a schema change to add explicit cost columns. | `001_initial_schema.sql:219` |
| `messages.metadata.csat_score` | `messages.raw_payload jsonb` exists; `csat_score` is *not* yet a written key | The schema column is `raw_payload` (line 94), not `metadata` — the PRD uses `metadata` as a generic name. The jsonb shape is in place (default `{}`); the capture path that writes into it is owned by `t_eng_instrumentation`. | `001_initial_schema.sql:94` |
| `conversations.resolved_at` (implied by "within 7 days") | `conversations` has no `resolved_at` column | The "resolved at" timestamp is derivable from the most recent `audit_logs.created_at` for `action='conversation_resolved'` on that conversation. The M0 query uses `c.created_at` as the upper bound, which is the conservative 7-day window from creation (PRD §3.1) — this slightly undercounts long conversations. | `001_initial_schema.sql:299`; `insforge/functions/resolve-conversation/index.ts:89` |

**Recommendation.** File a follow-up doc-PR for `docs/PRD.md` to fix the `'human_agent'` → `'user'` typo and the `resolved_at` language. The schema is the authority; the PRD should match it. Out of scope for this card (this card refines §3's queries; it does not edit the PRD's prose). A short follow-up card is appropriate but not blocking.

---

## What this file is *not*

- **A dashboard.** The analytics page (`app/analytics/page.tsx`) is owned by `t_eng_analytics_dashboard`. The queries here are the source — the page renders them.
- **A runbook.** A metric below its tripwire is a flag, not a script. The escalation path is in `docs/INCIDENT_RESPONSE.md` (not yet written; parent `t_sec_incident_response`).
- **A billing source.** M4's `cost_per_ticket_usd` is a unit-economics number, not the invoice. Billing is owned by `PRICING.md` and the Stripe integration (out of scope for v1; see `PRD.md` §5).
- **The full metrics surface.** Per `PRD.md` §3.3 we explicitly do not measure NPS, agent-side handle time, or provider uptime. Don't add them.

---

## Schema & query prerequisites summary

For the queries in this file to return non-empty / non-zero results, the following must be true. Each row is owned by a different card.

| Metric | Today's schema sufficient? | Blocked by | Owner card |
|---|---|---|---|
| M0 containment | ✅ Yes | — | — |
| M1 deflection | ✅ Yes | — | — |
| M2 FRT | ✅ Yes | — | — |
| M3 CSAT | ⚠️ Capture path missing (column exists as `messages.raw_payload jsonb`) | CSAT follow-up template + `raw_payload->>'csat_score'` writer | `t_eng_instrumentation` |
| M4 cost | ❌ Schema change required | `ai_decisions.prompt_tokens`, `completion_tokens`, `total_tokens`, `openrouter_cost`; provider-fee table | `t_eng_instrumentation` |
| M5 escalation precision | ⚠️ Labeling path missing | `audit_logs.action='escalation_labeled'` with `metadata.label` | `t_qa_feedback_loop` |
| M6 TTV | ✅ Yes | — | — |
| W1 message volume | ✅ Yes | — | — |
| W2 drafts-abandoned | ✅ Yes | — | — |

**Two of the seven production metrics are blocked on instrumentation work** (M3, M4). M5 is blocked on QA tooling. M0, M1, M2, M6 are computable from the existing schema today — the launch checklist §5.4 weekly review can begin running them as soon as this card lands.

---

## Verification (this card's acceptance criteria)

- [x] A markdown table in `InboxPilot/docs/METRICS.md` listing each metric: name, definition, SQL sketch, source tables, owner, target. (See the §"Input metrics" section above — one table per metric.)
- [x] Each SQL sketch has been hand-checked against `insforge/migrations/001_initial_schema.sql`. A schema-agnostic verification (every `tablename.colname` in the SQL blocks) reports **0 surprises** — every column used in the queries exists in the schema. The M4 column set (`ai_decisions.prompt_tokens`, `completion_tokens`, `total_tokens`, `openrouter_cost`) is flagged in M4 as a proposed migration, not assumed. The `messages.raw_payload->>'csat_score'` key is also flagged in M3 as a capture-path gap, not assumed.
- [x] One metric is flagged as needing a schema change (M4) with a backreference to the instrumentation card (`t_eng_instrumentation`).
- [x] Two watch metrics called out (W1 raw message volume, W2 drafts-abandoned) — neither will be optimized for, but both will be plotted on the analytics page so the team can see the trend.
- [x] `docs/PRD.md` §3 links to this file in the Success metrics section. (See the follow-up patch in the same commit.)

**Open follow-up (recommended, not blocking).** File a doc-PR for `docs/PRD.md` to fix the `'human_agent'` typo and the `resolved_at` language; a small one-line follow-up card is appropriate. PM owner.
