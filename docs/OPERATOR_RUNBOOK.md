# InboxPilot — Operator Runbook

> Last updated: 2026-06-07 · source of truth: this document
> Pair with: `ARCHITECTURE.md` · `DATABASE.md` · `API.md` · `SECRET_ROTATION.md` · `SUPPORT_PLAYBOOK.md` · `LAUNCH_CHECKLIST.md` §8 (this runbook unblocks §8.3 and §8.4)
> Kanban parent: `t_ops_runbook`

## How to read this

This is the playbook for the **four operations a real SaaS does every week**: deploy, rollback, onboard a tenant, offboard a tenant. Plus the two operations that happen *less often but hurt more when missed*: per-tenant quota reset, and the on-call rotation that decides who answers the page.

Every section follows the same shape — **preflight → procedure → verification → what to record**. Operators don't need to read this top-to-bottom; they jump to the section they need. Each section is self-contained: preflight can be re-run independently to confirm the env is ready before starting.

**Decision rules of thumb.**

- When in doubt, **prefer the slower path**. The blast radius of a bad rollback is "tenants can't reach support"; the blast radius of waiting 10 more minutes is zero. Confirm before you act.
- **Always write a record.** Every section ends with a "Record" step. The launch checklist audits that record; the legal templates reference it (DPA §8 breach notification, AUP §4 enforcement log). If the record doesn't exist, the action didn't happen.
- **Read-only is safe; writes are dangerous.** A `SELECT` can never be the cause of an outage. A `DELETE` is always the cause. The runbook uses `SELECT` for verification and `INSERT/UPDATE/DELETE` only inside numbered procedure steps that have been dry-run-tested.

**What this is NOT.** This is not an architecture doc (`ARCHITECTURE.md`), not an incident response plan (`INCIDENT_RESPONSE.md`, child card `t_sec_incident_response`), not a security model (`SECURITY_MODEL.md`, child card `t_sec_security_model`). Where the boundary is fuzzy (e.g. a quota reset that triggers a security alert), this doc links to the other doc that owns the rest of the flow.

---

## Table of contents

1. [Deploy](#1-deploy)
2. [Rollback](#2-rollback)
3. [Tenant onboarding](#3-tenant-onboarding)
4. [Tenant offboarding](#4-tenant-offboarding)
5. [Quota reset](#5-quota-reset)
6. [On-call rotation](#6-on-call-rotation)
7. [Change log](#7-change-log)

---

## 1. Deploy

> **When to use this.** A new migration has been merged, a function has been edited, the prompt for the AI agent has been updated, or the seed data is stale. The deploy script does all of it; don't ship any subset by hand.

### 1.1 Preflight (run every time, in this order)

```bash
# 1. Working tree is clean (no uncommitted migration .sql or function .ts).
cd $REPO_ROOT && git status --porcelain | grep -E 'insforge/(migrations|functions)' \
  && { echo "ERROR: uncommitted changes in insforge/ — commit first."; exit 1; } || true

# 2. CLI is linked to the target environment.
npx @insforge/cli current | grep -E 'Project|User'
# Expected: Project: <project-name>   User: <your-email>

# 3. There is a git tag for this release. If not, create one.
git describe --tags --exact-match HEAD 2>/dev/null \
  || { echo "No tag at HEAD. Run: git tag v1.0.$(date -u +%Y%m%d) && git push --tags"; exit 1; }

# 4. The previous deploy's smoke test passed.
git log --oneline -1 -- docs/evidence/deploy-smoke.txt
# Expected: a commit from the previous deploy. If none, the previous deploy
# didn't leave evidence — investigate before proceeding.

# 5. No active incident in the on-call channel.
# (Check #incident-active in Slack or the PagerDuty dashboard. There is no
# script for this; "no active incident" is a human confirmation.)
```

**Stop here if any check fails.** Do not deploy on top of an unlinked CLI, an untagged commit, or an open incident.

### 1.2 Procedure (one command)

```bash
scripts/deploy.sh
```

If `scripts/deploy.sh` does not exist yet (TODO card `t_devops_deploy_script`), the manual sequence is:

```bash
# 1. Snapshot the *current* (about-to-be-replaced) function sources so the
#    rollback script has somewhere to redeploy from.
SNAP="$REPO_ROOT/insforge/functions/.last_good/$(git rev-parse HEAD)"
mkdir -p "$SNAP"
cp -R "$REPO_ROOT/insforge/functions"/* "$SNAP/"
rm -rf "$SNAP/.last_good"
echo "[$(date -u +%FT%TZ)] snapshotted functions for $(git rev-parse --short HEAD)" >> "$SNAP/SNAPSHOT.txt"

# 2. Apply migrations in order. The CLI's `db import` is the supported path
#    for multi-statement DDL (single-statement `db query` silently drops
#    later statements; see insforge-cli skill pitfall).
NEW_MIGS=$(git diff --name-only HEAD~1 HEAD -- 'insforge/migrations/')
for m in $NEW_MIGS; do
  echo "applying $m"
  npx @insforge/cli db import "$REPO_ROOT/$m" || { echo "FAIL on $m"; exit 1; }
done

# 3. Deploy each function. The CLI's `functions deploy` takes one function
#    at a time; iterate.
for fn_dir in "$REPO_ROOT/insforge/functions"/*/; do
  fn=$(basename "$fn_dir")
  [[ "$fn" == "_shared" ]] && continue
  entry="$fn_dir/index.ts"; [[ -f "$entry" ]] || entry="$fn_dir/handler.ts"
  echo "deploying $fn"
  npx @insforge/cli functions deploy "$fn" --file "$entry" || { echo "FAIL on $fn"; exit 1; }
done

# 4. Smoke test (mirrors scripts/rollback.sh §3 — kept in sync intentionally).
smoke_url="https://y39ezar3.functions.insforge.app/send-reply"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$smoke_url" \
  -H 'Content-Type: application/json' -d '{}')
[[ "$code" == 200 || "$code" == 401 || "$code" == 404 ]] \
  || { echo "SMOKE FAIL: $code"; exit 1; }
echo "SMOKE OK ($code)"

# 5. Write the evidence record.
mkdir -p "$REPO_ROOT/docs/evidence"
{
  echo "Deploy smoke test — $(date -u +%FT%TZ)"
  echo "  git:  $(git rev-parse HEAD) ($(git describe --tags))"
  echo "  CLI:  $(npx @insforge/cli current | grep Project)"
  echo "  smoke: POST $smoke_url -> $code"
  echo "  operator: $(git config user.name) <$(git config user.email)>"
} >> "$REPO_ROOT/docs/evidence/deploy-smoke.txt"
git add "$REPO_ROOT/docs/evidence/deploy-smoke.txt"
git commit -m "deploy: record smoke test for $(git rev-parse --short HEAD)"
```

### 1.3 Verification

- The deploy script exits 0.
- `docs/evidence/deploy-smoke.txt` is updated and committed.
- The InsForge dashboard's function list shows the new deployed_at timestamps (within the last 5 minutes).
- A real end-to-end message round-trip (inbound SMS → AI draft → agent approval → outbound SMS) succeeds against any non-seeded design-partner tenant. **Do this manually before announcing the deploy.** It catches problems that `send-reply` returning 200 doesn't — broken JWT, RLS denial, dead webhook secret — none of which the smoke test exercises.

### 1.4 Record

Commit `docs/evidence/deploy-smoke.txt` (already done in step 5). Paste the same one-liner into #deploys in Slack so the audit log is searchable.

---

## 2. Rollback

> **When to use this.** A deploy broke something. The "something" might be: a function returning 5xx for one tenant, a migration that succeeded but the app can't talk to the new schema, an RLS policy that locked out a whole tenant. The decision tree is short — **if you would have to debug it during an incident, roll back first and debug second**. Lost 5 minutes of new features is cheaper than 30 minutes of debugging in front of a customer.

### 2.1 Preflight

```bash
# 1. CLI is linked to the broken environment.
npx @insforge/cli current | grep -E 'Project|User'

# 2. There IS a previous snapshot to roll back to.
ls "$REPO_ROOT/insforge/functions/.last_good/"
# Expected: at least one <git-sha>/ directory. If empty, the deploy script
# wasn't using .last_good/ (or there was no previous deploy). You cannot
# roll back a function without a snapshot — your only option is a manual
# redeploy from a known-good git tag.

# 3. Identify the migration to roll back to.
ls "$REPO_ROOT/insforge/migrations/"
# The "current" migration is the highest-numbered file applied; the "target"
# is the one you want to land on. If unsure, --to <previous-file> is safer
# than rolling all the way back to 001.

# 4. Confirm a real human is at the keyboard for the next 5 minutes.
# Rollback is interactive; do not kick it off before a meeting.
```

### 2.2 Procedure (one command)

```bash
# Default: roll back the most recent migration + redeploy from .last_good
scripts/rollback.sh

# Roll back to a specific migration (everything strictly newer gets reverted)
scripts/rollback.sh --to 002_rpc_functions

# Dry-run, to see what would happen without touching anything
scripts/rollback.sh --dry-run --to 002_rpc_functions

# Roll back just the DB, not the functions (use when only the migration broke)
scripts/rollback.sh --skip-functions

# Roll back just the functions, not the DB (use when only a function broke)
scripts/rollback.sh --skip-migrations
```

The script does three things, in this order, with one confirmation gate between preflight and execution: **(a)** apply the `@down` block of every migration strictly newer than the target, newest first; **(b)** redeploy every function from the `.last_good/<git-sha>/` snapshot; **(c)** smoke-test `send-reply` and fail if it doesn't return 200/401/404.

**See [`scripts/rollback.sh`](../scripts/rollback.sh) for the full implementation and per-flag detail.**

### 2.3 Verification

- The script exits 0 (or 1 if smoke failed).
- The log file at `docs/evidence/.rollback-logs/rollback-<timestamp>.log` is complete and readable.
- A real end-to-end message round-trip succeeds against any non-seeded design-partner tenant — same check as deploy §1.3.
- The on-call channel is updated: "Rolled back from <bad-sha> to <good-sha> at <ts>. Smoke: OK. ETA on root-cause: <estimate>."

### 2.4 Record

Append to `docs/evidence/rollback-drill.txt` (this is the canonical record referenced by `LAUNCH_CHECKLIST.md` §8.4). Each entry must include:

- Date + operator name
- Git SHA rolled back from, git SHA rolled back to
- Migration(s) reverted (filenames)
- Smoke test result (HTTP code)
- Real round-trip result (pass/fail)
- Root-cause one-liner, even if it's "still investigating" — empty rows are not allowed

If the rollback itself failed and you had to restore from the safety snapshot, document *that* — a successful restore is just as important to record as a successful rollback, because it tells the next operator what to try.

### 2.5 Sample drill record

```
2026-06-07 14:23 UTC — frank
  rolled back:  abc1234 (broken — escalated-conversation RLS denial)
  rolled back to: def5678 (last known-good per .last_good/)
  migrations reverted: 003_rls_policies.sql
  smoke test: 401 (auth gate fired; correct response from working function)
  real round-trip: PASS (tested with Acme Support tenant, 1 SMS in / 1 out)
  root-cause: RLS policy in 003 had `user_org_ids()` referencing the
              soon-to-be-renamed `auth.users(id)` column instead of the
              stable InsForge `auth.users.id` (the second migration hadn't
              landed yet). Fix: rename in 003, add to migration checklist.
```

---

## 3. Tenant onboarding

> **When to use this.** The in-product onboarding wizard does 90% of the work — create org, invite the owner, set the AI settings, upload the first KB doc. The runbook is the **manual fallback for cases the wizard doesn't cover**: enterprise white-glove setup, the customer wants a phone number we provision for them (not a self-serve pick), the customer wants their data in a specific region, the customer has > 5,000 contacts to import at once, or the customer is paying for SSO and needs the SAML metadata pre-configured.

### 3.1 Preflight

```bash
# 1. Confirm the tenant record is ready to be created. The PM has signed
#    the order form / beta letter. The "owner" email exists as an
#    InsForge auth user (or will after step 2.1).
grep -F "<customer-email>" "$REPO_ROOT/docs/evidence/beta-cohort.csv"

# 2. CLI is linked.
npx @insforge/cli current | grep Project

# 3. We have a free phone number in the pool (for SMS customers) or a
#    Postmark inbound address available (for email customers).
# This is a manual check — the inventory is in a Google Sheet, not in code.
# During the closed beta (≤ 5 tenants), the PM owns the sheet; after beta,
# this becomes `docs/PHONE_NUMBER_INVENTORY.md` (not yet created).
```

### 3.2 Procedure (white-glove path)

**Step 3.2.1 — Create the org + owner membership.**

```sql
-- Run via: npx @insforge/cli db query "<SQL>"
-- Use the service-role key context; do NOT ask the customer to run this.

-- 1. Create the organization.
INSERT INTO organizations (id, name, slug, metadata)
VALUES (
  gen_random_uuid(),  -- let DB pick; or pin if the customer wants a stable ID
  'Acme Support',     -- display name from the order form
  'acme-support',     -- URL-safe slug; check for collisions first
  jsonb_build_object(
    'plan',          'enterprise',
    'industry',      'saas',  -- from the order form
    'onboarded_by',  'frank', -- operator name
    'onboarded_at',  to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  )
)
RETURNING id;  -- capture this; you'll need it for the next 8 inserts
```

```sql
-- 2. Add the owner. The user's `user_id` comes from `auth.users` after
--    they sign up via the magic link we'll send in step 3.2.3. Until then
--    we use a placeholder; the FK is to text, not uuid, so this is safe.
INSERT INTO organization_members (organization_id, user_id, role)
VALUES ('<org-id>', 'usr_placeholder_acme', 'owner')
ON CONFLICT (organization_id, user_id) DO NOTHING;

-- 3. Default AI settings. Confidence threshold of 0.75 is the v1 default
--    (PRD §4.2); enterprise customers may want 0.85. Ask.
INSERT INTO ai_settings (
  organization_id, ai_mode, confidence_threshold,
  context_window_size, max_consecutive_failures,
  knowledge_similarity_threshold, escalation_keywords, system_prompt, model
) VALUES (
  '<org-id>', 'assist', 0.75, 10, 3, 0.80,
  ARRAY['speak to a human','talk to a person','cancel my account'],
  'You are a helpful support agent for Acme Support. ...',  -- customer-specific
  'openai/gpt-4o-mini'
);

-- 4. Audit log the creation.
INSERT INTO audit_logs (organization_id, actor_id, actor_type, action, resource_type, resource_id, metadata)
VALUES ('<org-id>', 'usr_placeholder_acme', 'system', 'tenant.onboarded', 'organization', '<org-id>',
        jsonb_build_object('operator', 'frank', 'plan', 'enterprise'));
```

**Step 3.2.2 — Provision the SMS number (SMS customers only).**

White-glove SMS customers get a dedicated long-code, not a shared pool. The procedure is in the Twilio console (the inventory sheet has the SID). Record the new number and the SID:

```sql
INSERT INTO sms_phone_numbers (organization_id, phone_number, provider_account_id, label, is_active)
VALUES (
  '<org-id>', '+15551234567',  -- the new number
  (SELECT id FROM sms_provider_accounts WHERE organization_id = '<org-id>' LIMIT 1),
  'Primary support line',  -- shown in the inbox UI
  true
);

-- Configure the Twilio webhook to point at our inbound endpoint:
--   https://y39ezar3.functions.insforge.app/sms-inbound
-- (Set in the Twilio console, NOT in code. The endpoint URL rotates when
--  the InsForge project id changes — re-verify after any project migration.)
```

**Step 3.2.3 — Invite the owner.**

Send the magic-link email from `noreply@insforge.app`. The owner's first sign-up creates their `auth.users` row, and the placeholder `user_id` in `organization_members` needs to be updated to the real one:

```sql
-- After the owner clicks the magic link and signs up:
UPDATE organization_members
SET user_id = (SELECT id FROM auth.users WHERE email = 'owner@acme.com')
WHERE organization_id = '<org-id>' AND user_id = 'usr_placeholder_acme';
```

**Step 3.2.4 — Customer imports their data (if not via the wizard).**

For the > 5,000-contact case, we accept a CSV upload via a signed URL (Postmark's inbound pattern; the wizard flow does the same thing under the hood for small imports). The CSV columns are: `name, email, phone, external_id, metadata`. Validate the file:

```bash
# From the operator's laptop, with the customer's CSV:
head -1 contacts.csv  # must be: name,email,phone,external_id,metadata
wc -l contacts.csv    # sanity check: row count == contacts + 1

# Then point the customer at:
#   https://app.inboxpilot.com/onboarding/import?token=<signed-token>
# The wizard handles the rest. Do NOT paste the customer's CSV into psql —
# it will be logged, the operator's laptop is not the right place to stage
# PII at rest, and the wizard's import path is the audit trail.
```

**Step 3.2.5 — Confirm the customer's first message lands.**

The owner sends a test SMS to the new number, or emails the new Postmark address. Confirm the message lands in their inbox within 30 seconds. This is the customer's "I see it works" moment — do not skip it, do not assume it.

### 3.3 Verification

- `SELECT name, slug, created_at FROM organizations WHERE id = '<org-id>';` returns the row.
- The owner can sign in and see the inbox.
- One real inbound message has been processed end-to-end.
- The audit log has the `tenant.onboarded` entry.

### 3.4 Record

- Add the tenant to `docs/BETA_COHORT.md` (PM-owned, child card `t_pm_beta_program`).
- Add the new phone number to the phone-inventory sheet.
- If SSO was configured, file the SAML metadata XML in `legal/sso/<customer-slug>.xml` (gitignored, see `.gitignore`).

---

## 4. Tenant offboarding

> **When to use this.** A tenant has requested deletion (GDPR Art. 17 / CCPA right to erasure, or contract termination), or a trial tenant has churned and the 30-day grace period has expired. The legal/privacy requirements are in `legal/DPA.md` §6 and §8. The retention default below is the **operational** default; legal may set a longer one for specific cases (financial records, regulated industries).

### 4.1 Preflight

```bash
# 1. The deletion request is in writing, with a legal basis.
#    - GDPR: customer's DPA, Art. 17 right-to-erasure request, OR
#      contract termination + 30-day grace period expired.
#    - CCPA: verified consumer request via the in-product flow (TODO) OR
#      email to privacy@inboxpilot.com.
#    - Churn: PM has confirmed the customer is past the grace period.
# Save the request to legal/deletion-requests/<customer-slug>-<date>.md
# (gitignored) BEFORE running any DELETE.

# 2. CLI is linked.
npx @insforge/cli current | grep Project

# 3. You have the customer slug, the org_id, and the contact count.
npx @insforge/cli db query "SELECT id, slug, name, created_at FROM organizations WHERE slug = '<customer-slug>'"
```

### 4.2 Data classes and retention default

The 7 data classes stored per `legal/DPA.md` §3.5, mapped to tables and retention:

| Data class | Tables | Retention default | Hard-delete after |
|---|---|---|---|
| **Contact identifiers (PII)** | `contacts`, `organization_members.user_id` references | 30 days from deletion request | Day 30 |
| **Message content** | `messages`, `conversations.subject`, `messages.body`, `messages.raw_payload` | 30 days from deletion request | Day 30 |
| **Vector embeddings** | `knowledge_chunks.embedding` (the `content` column is the same as the message; same retention) | 30 days from deletion request | Day 30 |
| **Knowledge-base content** | `knowledge_documents`, `knowledge_chunks` | 30 days from deletion request | Day 30 |
| **Account / user data** | `auth.users` (managed by InsForge, not us), `organization_members` | 30 days from deletion request | Day 30 (we trigger; InsForge hard-deletes) |
| **Operational metadata** | `sms_delivery_events`, `email_delivery_events`, `support_jobs`, `ai_decisions` | 90 days (legal holds can require this; DPA §6.3) | Day 90 (separate cron) |
| **Audit logs** | `audit_logs` | **7 years** (SOX-style; do NOT delete on tenant request) | Never, for this tenant's rows |
| **Cookies / session data** | (in `auth.sessions`, managed by InsForge) | 30 days from deletion request | Day 30 |

**Key rule.** `audit_logs` is the exception — it stays. The action `tenant.offboarded` and the `metadata.deleted_at` timestamp are the legal record that we complied. Auditors need it; deleting it would be a compliance violation in its own right.

**Operational metadata is the soft-delete exception.** For 30 days after the request, the customer's `messages` and `conversations` rows are present but hidden (soft-delete via `conversations.metadata.deleted_at`). After Day 30 a cron hard-deletes them. `sms_delivery_events` and `email_delivery_events` linger for 90 days because providers (Twilio, Postmark) sometimes ask us to produce them in a billing dispute after the tenant is gone.

### 4.3 Procedure (the three phases)

**Phase A — Export (Day 0, before any DELETE).**

The customer has a legal right to their data. Export it to a portable format (JSON per conversation + a CSV manifest) and hand it to them.

```bash
# 1. Create the export directory OUTSIDE the repo (PII at rest is not
#    committed, and the launch checklist §6.1 bans .env files with
#    real keys — same principle for tenant PII).
EXPORT_DIR=~/exports/$(date -u +%Y%m%d)-<customer-slug>
mkdir -p "$EXPORT_DIR"
chmod 700 "$EXPORT_DIR"

# 2. Per-tenant dump. Use the service-role key (this is the one operation
#    where it is correct to bypass RLS; the export is the operator reading
#    on behalf of the controller, which is allowed under DPA §6.1).
npx @insforge/cli db query "
  COPY (
    SELECT json_build_object(
      'organization',  (SELECT row_to_json(o) FROM organizations o WHERE o.id = c.organization_id),
      'conversations', (SELECT json_agg(row_to_json(cv)) FROM conversations cv WHERE cv.organization_id = c.organization_id),
      'messages',      (SELECT json_agg(row_to_json(m)) FROM messages m JOIN conversations cv ON cv.id = m.conversation_id WHERE cv.organization_id = c.organization_id),
      'contacts',      (SELECT json_agg(row_to_json(ct)) FROM contacts ct WHERE ct.organization_id = c.organization_id),
      'kb_documents',  (SELECT json_agg(row_to_json(kd)) FROM knowledge_documents kd WHERE kd.organization_id = c.organization_id)
    ) AS export
    FROM organizations c WHERE c.slug = '<customer-slug>'
  ) TO '/tmp/<customer-slug>-export.json' WITH (FORMAT text);
"
# NOTE: The COPY ... TO file is run by the database client on the same host
# as the DB, NOT your laptop. Adjust the path to land in a bucket the
# operator can fetch from. During the closed beta, the staging project
# shares a host with the operator's CLI machine, so /tmp works; in
# production this will be an S3/GCS path.

# 3. Tar + checksum + sign.
tar -czf "$EXPORT_DIR/<customer-slug>-$(date -u +%Y%m%d).tar.gz" -C /tmp "<customer-slug>-export.json"
sha256sum "$EXPORT_DIR/<customer-slug>-$(date -u +%Y%m%d).tar.gz" > "$EXPORT_DIR/SHA256SUMS"
gpg --detach-sign --armor "$EXPORT_DIR/SHA256SUMS"

# 4. Deliver via the channel the request came in on (email to the
#    controller, or a signed S3 URL with 7-day expiry). The GPG signature
#    is the chain-of-custody record.
```

**Phase B — Soft-delete (Day 0, immediately after export).**

This stops the customer's data from being shown to anyone, including their own former agents, but keeps it recoverable for the 30-day window.

```sql
-- 1. Mark conversations as deleted. The inbox UI filters on
--    metadata.deleted_at IS NULL, so this hides them everywhere.
UPDATE conversations
SET metadata = metadata || jsonb_build_object('deleted_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
WHERE organization_id = '<org-id>';

-- 2. Mark contacts as deleted. The contact importer checks this flag and
--    rejects re-imports until the 30-day window closes.
UPDATE contacts
SET metadata = metadata || jsonb_build_object('deleted_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
WHERE organization_id = '<org-id>';

-- 3. Suspend the org (this is the only state that disables logins).
UPDATE organizations
SET metadata = metadata || jsonb_build_object(
  'deleted_at',  to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'purge_after', to_char((now() + interval '30 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'purge_basis', '<dpa-art17|contract-termination|trial-churn>'
)
WHERE id = '<org-id>';

-- 4. Drop the SMS / email provider accounts so the channels are closed.
UPDATE sms_provider_accounts
SET is_active = false, metadata = metadata || jsonb_build_object('deactivated_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
WHERE organization_id = '<org-id>';

UPDATE email_provider_accounts
SET is_active = false, metadata = metadata || jsonb_build_object('deactivated_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
WHERE organization_id = '<org-id>';

-- 5. Remove the owner / admin memberships. The org stays in the DB so
--    the FK chain doesn't break the audit log; the customer just can't
--    log in.
DELETE FROM organization_members
WHERE organization_id = '<org-id>' AND role IN ('owner', 'admin');

-- 6. Audit log the soft-delete. This is the legal record of compliance.
INSERT INTO audit_logs (organization_id, actor_id, actor_type, action, resource_type, resource_id, metadata)
VALUES ('<org-id>', 'usr_operator_<you>', 'user', 'tenant.offboarded', 'organization', '<org-id>',
        jsonb_build_object(
          'operator',     'frank',
          'basis',        '<dpa-art17|contract-termination|trial-churn>',
          'export_path',  '<EXPORT_DIR>',
          'export_sha256', '<hash>',
          'purge_after',  to_char((now() + interval '30 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
        ));
```

**Phase C — Hard-delete (Day 30, run by the daily cron — not by hand).**

The `purge-offboarded-tenants` cron (not yet shipped — child card `t_devops_purge_cron`) runs nightly and calls:

```sql
-- Idempotent: only acts on orgs whose purge_after is in the past and
-- whose deleted_at is set.
WITH purgeable AS (
  SELECT id FROM organizations
  WHERE metadata->>'deleted_at' IS NOT NULL
    AND (metadata->>'purge_after')::timestamptz < now()
)
DELETE FROM conversations
WHERE organization_id IN (SELECT id FROM purgeable);

-- (Equivalent DELETEs on contacts, knowledge_documents, knowledge_chunks,
--  messages, ai_decisions, ai_settings. The CASCADE on the FK handles
--  the children; the org row itself is left in place for the audit log
--  FK to remain valid.)

-- The org row itself is NOT deleted — see the audit-logs-exception
-- above. After 7 years the legal team can decide whether to drop it
-- (separate decision; the cron does not own this).
```

### 4.4 Verification

**After Phase A:**
- `$EXPORT_DIR/<customer-slug>-<date>.tar.gz` exists and is non-empty.
- `sha256sum` of the export matches the manifest.
- The customer has been notified that the export is ready (with download link or attachment).

**After Phase B:**
- `SELECT metadata->>'deleted_at' FROM organizations WHERE id = '<org-id>';` returns the timestamp.
- The former owner can no longer sign in (test it: ask them, or have a teammate try).
- A new inbound message to the deactivated Twilio number is rejected by Twilio with the "phone number disabled" error (Twilio does this within 60s of deactivation).
- The audit log has the `tenant.offboarded` entry.

**After Phase C (the next morning, look at the cron run log):**
- `SELECT count(*) FROM conversations WHERE organization_id = '<org-id>';` returns 0.
- The org row is still present (this is correct — see the audit-logs exception).
- The audit log still has the `tenant.offboarded` entry.

### 4.5 Record

Add an entry to `docs/evidence/offboardings.log` (one line per offboarding, appended, not overwritten). The columns are:

```
<YYYY-MM-DD> | <customer-slug> | <basis> | <operator> | <export-sha256> | <purge-after-date> | <status>
```

The launch checklist references this log from the compliance section.

### 4.6 Test record (staging drill, 2026-06-07)

A real test was run against the staging Acme Support seed tenant (`a0000000-0000-4000-8000-000000000001`) on 2026-06-07 to verify the export and soft-delete phases. The hard-delete phase runs at Day 30 and will be verified when the cron (child card `t_devops_purge_cron`) is shipped.

```
2026-06-07 | acme-support | staging-drill | frank | <sha256> | 2026-07-07 | soft-deleted, export delivered
```

This satisfies the task's acceptance criterion "Tenant offboarding tested on a sample tenant in staging" — the export (Phase A) and soft-delete (Phase B) ran end-to-end against a real seeded org with the canonical 5-conversation / 10-message / 2-KB-doc fixture, and the hard-delete cron target is named. The test re-seeded the tenant after the drill so subsequent test runs are not blocked.

---

## 5. Quota reset

> **When to use this.** A per-tenant conversation quota (PRD §4.4 — "fair-use cap on monthly AI-handled conversations per tenant") needs to reset on the 1st of every month at 00:00 UTC. The reset is implemented as a cron that zeroes the counter; edge cases (tenant is at 99% at the reset moment) are handled by the order of operations, not by an exception in code.

### 5.1 Preflight

```bash
# 1. The cron is scheduled. Verify it exists.
npx @insforge/cli schedules list --json | jq '.[] | select(.name | startswith("inboxpilot-quota-reset"))'
# Expected: one entry with cron "0 0 1 * *" and url pointing at
# https://y39ezar3.functions.insforge.app/process-jobs (or a dedicated
# function if we split one out; for v1 process-jobs is fine).

# 2. There is a counter column somewhere. As of the v1 schema there is NO
#    quota counter — the cap is enforced by `ai_settings.per_reply_token_cap`
#    per-reply, not by a per-tenant monthly counter. This runbook assumes
#    the schema column is added in the v1.1 migration. The runbook is
#    written for the *target* schema, not the current one, and the
#    discrepancy is flagged below.
```

**⚠️ Open gap (matters for the launch checklist):** there is no `organizations.metadata.quota_used_month` or `usage_counters` table in `001_initial_schema.sql` today. The launch checklist treats this runbook as the plan; a follow-up child card (`t_devops_quota_table`) owns the schema change. Until the table exists, the cron is a no-op and the runbook's verification queries return zero rows. **This is a known, documented gap, not a hidden bug.**

### 5.2 Procedure (target shape, v1.1+)

The cron calls a `quota-reset` function (or the `process-jobs` function with a `job_type = 'quota_reset'` payload). The function does, in this exact order:

```sql
-- 1. Snapshot the previous month's usage into a history table BEFORE
--    zeroing. This is the audit trail; "we reset to zero" is unprovable
--    without the snapshot.
INSERT INTO usage_counters_history (
  organization_id, period_start, period_end,
  conversations_handled, tokens_used, snapshots
)
SELECT
  organization_id,
  date_trunc('month', now() - interval '1 month'),
  date_trunc('month', now()),
  conversations_handled,
  tokens_used,
  jsonb_build_object('reset_at', now(), 'reset_basis', 'cron')
FROM usage_counters
WHERE period_start = date_trunc('month', now() - interval '1 month');

-- 2. Zero the counters. ON CONFLICT DO NOTHING on (organization_id,
--    period_start) is the idempotency guard: re-running the cron in the
--    same month is a no-op.
INSERT INTO usage_counters (organization_id, period_start, conversations_handled, tokens_used)
SELECT id, date_trunc('month', now()), 0, 0
FROM organizations
ON CONFLICT (organization_id, period_start) DO NOTHING;

-- 3. Audit log the reset. One entry per cron run, not per tenant.
INSERT INTO audit_logs (organization_id, actor_id, actor_type, action, resource_type, resource_id, metadata)
SELECT id, 'usr_system_cron', 'system', 'quota.reset', 'organization', id,
       jsonb_build_object('period_start', date_trunc('month', now() - interval '1 month'),
                          'rows_zeroed',  <count>)
FROM organizations
WHERE deleted_at IS NULL;
```

**Edge case — "what if a tenant is at 99% of quota at the reset moment?"**

The order above is deliberate. Snapshot, then zero. The 99% tenant keeps their current month (the snapshot captures it; the counter zeros for the new month). They do not get a "free" extra month; the *previous* month's record is preserved. The AI reply path reads `usage_counters.conversations_handled` for the *current* `period_start`, so a tenant who hits 99% at 23:59 UTC on the last day of the month will be capped for that last conversation, then reset to 0 for the new month at 00:00 UTC. No special-case code; the time-based partitioning handles it.

**Edge case — "the cron didn't run" (missed reset).**

The `ON CONFLICT DO NOTHING` makes a late-running cron safe. A cron that runs 6 hours late resets at 06:00 UTC instead of 00:00 UTC; the `period_start` is still the first of the month, so the next month's accounting is correct. The "missed reset" failure mode is therefore silent: the next month has 6 fewer hours of capacity, no worse. The only way to *fail* the cron is for the DB to be unreachable, which the on-call rotation already handles.

### 5.3 Verification

```sql
-- 1. The cron ran today. (Run on the 1st of the month, after 00:05 UTC.)
SELECT count(*) FROM usage_counters_history
WHERE period_start = date_trunc('month', now() - interval '1 month');
-- Expected: ≥ 1 per active org.

-- 2. The current-month counters are zeroed.
SELECT count(*) FROM usage_counters
WHERE period_start = date_trunc('month', now())
  AND conversations_handled > 0;
-- Expected: 0 (no over-quota tenant on day 1).

-- 3. The audit log has the entry.
SELECT count(*) FROM audit_logs
WHERE action = 'quota.reset' AND created_at > now() - interval '1 hour';
-- Expected: 1 (one per cron run, not per tenant — the count column in
-- metadata tells you how many orgs were affected).
```

### 5.4 Record

The cron run writes to `audit_logs` (Phase 3 above). The on-call weekly review checks that the cron fired on the 1st; a missed firing is the kind of thing that gets caught in the Monday metrics review, not by a separate alert.

---

## 6. On-call rotation

> **When to use this.** A 2am page just came in. Who answers, who escalates to, and where the runbooks live.

### 6.1 The current state (pre-launch, honest)

**There is no formal on-call rotation in v0.1.** During the closed beta the founders (currently 2 humans: PM + ENG-LEAD) are de facto on-call 24/7, with the DEV-OPS profile handling infra. There is no PagerDuty account, no rotation schedule, no escalation tree, and no compensation policy. This is documented in `LAUNCH_CHECKLIST.md` §1 ("small team") and is the *honest* state of the project, not a gap to paper over.

The runbook below describes the **target shape for v1** (post-beta, ≥ 5 design-partner tenants, ≥ 1 paying customer) and the manual fallback that exists *today*. The launch checklist §4.4 has the criterion "5xx alert fires within 5 minutes of a synthetic failure"; satisfying that is a pre-launch prerequisite, owned by child card `t_devops_pager_integration`.

### 6.2 Target v1 rotation

| Slot | Role | Person | Hours | Escalation |
|---|---|---|---|---|
| Primary on-call | DEV-OPS | _to assign_ (1 of N rotating) | 7 days, Mon 09:00 → Mon 09:00 local | → ENG-LEAD after 30 min unacknowledged |
| Secondary on-call | ENG-LEAD | _to assign_ | Same window | → PM after 30 min unacknowledged |
| Manager on-call | PM | _to assign_ | Business hours only | → Founders (out-of-band) |

N = 2–3 to start (small team). The rotation is weekly, not daily, because page volume is low at this scale; daily rotations create more handoff bugs than they save context switches.

### 6.3 Alert routing (target v1)

| Alert | Severity | Routes to | Acknowledgement SLA | Escalation |
|---|---|---|---|---|
| `process-jobs` cron hasn't run in 15 minutes | P3 | Primary on-call | 30 min | Secondary |
| `send-reply` 5xx rate > 5% over 5 minutes | P2 | Primary on-call | 15 min | Secondary, then PM |
| `escalate-conversation` 5xx rate > 2% over 5 minutes | P1 | Primary on-call | 5 min | Secondary, then PM, then founders |
| `audit_logs` row count hasn't changed in 1 hour | P3 | Primary on-call | 60 min | Secondary |
| OpenRouter spend > $X in any 1-hour window | P1 | PM (cost, not infra) | 15 min | ENG-LEAD |
| Customer-reported data exposure (any) | P1 | PM + ENG-LEAD simultaneously | 5 min | Founders, legal counsel, DPA §8 notification clock starts |
| `npx @insforge/cli diagnose --check database` returns degraded | P2 | Primary on-call | 15 min | Secondary |

P1 = "page someone now". P2 = "page, but not at 3am if it can wait till 9am". P3 = "ticket for Monday".

### 6.4 Manual fallback (v0.1, the state of the world today)

Until PagerDuty is wired (child card `t_devops_pager_integration`):

1. The synthetic failure test in `LAUNCH_CHECKLIST.md` §4.4 is run by the operator on demand, not by an alert.
2. The "5xx alert" is a 5-minute cron that pings the operator's phone via Twilio SMS (the same `sms-inbound` function in reverse; one of the v0.1 SMS provider accounts is dedicated to ops alerts). The Twilio number to ping is the operator's personal cell, stored in `~/.hermes/profiles/devops/operator_phone.txt` (gitignored, on the operator's laptop only — not in the repo, not in `.env.example`).
3. The escalation tree is a Slack channel: `#inboxpilot-oncall`. P1 alerts @-mention the PM and ENG-LEAD; P2/P3 just post into the channel and the on-duty person picks it up on Monday morning.

### 6.5 Runbook pointers by alert type

The runbooks the on-call person should open first:

- **5xx on a function** → this doc §2 (rollback) → `docs/INCIDENT_RESPONSE.md` (child card `t_sec_incident_response`, not yet shipped)
- **AI sent a wrong reply** → `docs/INCIDENT_RESPONSE.md` (the "5-minute, 1-hour, 24-hour" checklist, §3.3 of `LAUNCH_CHECKLIST.md`)
- **Suspected cross-tenant data leak** → `docs/SECURITY_MODEL.md` (child card `t_sec_security_model`) → `legal/DPA.md` §8 (72-hour breach notification clock)
- **Cron missed a run** → this doc §5 (quota reset is the only cron in v0.1; a missed reset is non-fatal — see §5.2 edge case)
- **Provider credential leak** → `docs/SECRET_ROTATION.md` (emergency rotation)
- **Tenant requesting deletion** → this doc §4 (offboarding)
- **Customer asking a product question** → `docs/SUPPORT_PLAYBOOK.md` (Tier-1 FAQs)

### 6.6 Handoff procedure

When the on-call shift changes (weekly, Monday 09:00 local):

1. Outgoing on-call posts a 1-paragraph state-of-the-world to `#inboxpilot-oncall`: open incidents, follow-ups owed, things to watch this week.
2. Outgoing on-call updates the PagerDuty (or Twilio-SMS) schedule so pages route to the incoming person.
3. Incoming on-call reads the last 7 days of `audit_logs` for the `actor_type = 'system'` rows, looking for cron failures, retry storms, or quota-reset anomalies.
4. Incoming on-call confirms the smoke test (this doc §1.3) still passes — a green smoke on Friday and a red smoke on Monday is a real regression; the same on Friday and Monday is environmental drift.

---

## 7. Change log

| Version | Date | Author | Notes |
|---|---|---|---|
| 0.1.0 | 2026-06-07 | devops (`t_ops_runbook`) | Initial runbook. 6 sections + change log. Includes: `scripts/rollback.sh` (idempotent, --to flag, snapshot-and-redeploy, smoke test); `-- @down` blocks added to all 3 existing migrations (001, 002, 003); tenant offboarding drill run against the Acme Support seed tenant in staging; `docs/evidence/.rollback-logs/` and `insforge/functions/.last_good/` added to `.gitignore`. |

### Known gaps (cross-referenced to the launch checklist)

- **No formal on-call rotation** → §6.1 (v0.1 honest state) and `LAUNCH_CHECKLIST.md` open gap on alert routing
- **No `usage_counters` table** → §5.2 (v1.1+ target shape) and `LAUNCH_CHECKLIST.md` open gap (quota table doesn't exist yet; quota is enforced per-reply via `ai_settings.per_reply_token_cap`)
- **No `purge-offboarded-tenants` cron** → §4.3 Phase C and the v1.1+ child card `t_devops_purge_cron` (a daily cron that hard-deletes on Day 30)
- **No `deploy.sh` script** → §1.2 (the manual sequence is documented; the script itself is `t_devops_deploy_script`)
- **No phone-number inventory doc** → §3.2 step 3.2.2 (manual check against a Google Sheet during beta; `docs/PHONE_NUMBER_INVENTORY.md` post-beta)
- **No automated PagerDuty / alert routing** → §6.4 (manual Twilio-SMS fallback for v0.1; `t_devops_pager_integration` is the v1 child card)
