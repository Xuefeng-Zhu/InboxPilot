# InboxPilot — Provider Secret Rotation Runbook

> Last updated: 2026-06-07 · view this against commit `t_devops_secret_rotation` for accuracy.
> Source of truth: this document. Code references in `packages/support-core/src/adapters/twilio-sms-adapter.ts`, `postmark-email-adapter.ts`, and the function entrypoints under `insforge/functions/`.
> Pair with: [`docs/LOCAL_DEV.md`](./LOCAL_DEV.md) (webhook URLs change on rotation) · [`docs/SECURITY_MODEL.md`](./SECURITY_MODEL.md) (data classification + secret lifecycle — child card `t_sec_security_model`; not yet shipped) · [`docs/LAUNCH_CHECKLIST.md` §6 Compliance](./LAUNCH_CHECKLIST.md#section-6--compliance) (this runbook is referenced from rows 5.8 and 6.1) · [`docs/SUPPORT_PLAYBOOK.md` Q14](./SUPPORT_PLAYBOOK.md) (tenant-facing answer to "how do I rotate my credentials?").

## What this doc is

A runbook for rotating the three production provider credentials that InboxPilot stores in the InsForge secrets store — **without dropping a tenant or causing an SMS / email outage**. The credentials are:

| Provider  | Field in InsForge secret blob         | Used by                                       |
|-----------|--------------------------------------|------------------------------------------------|
| Twilio    | `auth_token` + `account_sid`         | `insforge/functions/sms-inbound`, `sms-status`, `send-reply` |
| Postmark  | `server_token`                       | `insforge/functions/email-inbound`, `email-status`, `send-reply` |
| OpenRouter | `api_key`                           | `insforge/functions/process-ai-job`, all AI calls via the InsForge AI gateway |

Each is referenced in the database by `sms_provider_accounts.credentials_secret_id`, `email_provider_accounts.credentials_secret_id`, and the `OPENROUTER_API_KEY` environment variable on the InsForge project, respectively. Rotating in place means **creating a new secret, then updating the row / env var to point at the new id** — never editing the old secret's value in place (most secret stores do not support this and even when they do it leaves no audit trail).

## When to use this runbook

- **Scheduled rotation** — quarterly per the compliance policy in `docs/SECURITY_MODEL.md`. Default: every 90 days.
- **Compromise response** — a developer laptop is stolen, a contractor offboards, a provider reports a breach. See "Emergency rotation" below.
- **Provider-initiated rotation** — Twilio / Postmark / OpenRouter force-rotates and emails you a new key. You have 24-72h before the old key is dead.

If the rotation is being done because of an active compromise, **also** follow `docs/SECURITY_MODEL.md` incident response — rotation alone does not close the incident.

---

## The three phases (use this every time)

Every rotation follows the same three phases, regardless of provider. The provider-specific differences live in the per-provider sections below.

### Phase 1 — Pre-rotation checklist

Complete every item before touching any secret. Skipping this is the #1 cause of rotation-induced outages.

- [ ] **Identify scope.** Which tenants / organizations are affected? Run:
      ```sql
      select organization_id, id, provider, label, is_active
      from sms_provider_accounts
      where provider = 'twilio' and is_active = true;
      ```
      (Equivalent query on `email_provider_accounts` for Postmark.)
- [ ] **Alert affected tenants.** Post a notice in the in-app banner *and* email the org owner (template: `templates/emails/secret-rotation-notice.md`). Set the maintenance window. Rotations under 60 seconds do not need a window; rotations that touch webhook config do.
- [ ] **Check the dashboard is reachable.** `npx @insforge/cli metadata --json` returns 200. If not, stop and fix that first.
- [ ] **Snapshot the current state.** Save the current `credentials_secret_id` for each account to a temporary file outside the repo (e.g. `~/rotations/2026-06-07-pre.json`). If the rotation goes wrong, this is your rollback.
- [ ] **Confirm the on-call engineer is present and free.** Rotation is interactive; do not start it before a meeting or a long break.
- [ ] **Open the provider's console in a second tab** so you can paste the new key the moment you generate it.

### Phase 2 — Rotate (per provider)

See the per-provider sections below. Each takes 1-5 minutes per tenant per provider.

### Phase 3 — Post-rotation verification

Run this list before declaring the rotation done. Every item must pass.

- [ ] **Send a test message of each channel** (SMS via the affected Twilio number, email to the affected Postmark inbound address). Both must arrive.
- [ ] **Run the test-connection function** for each rotated account:
      ```bash
      npx @insforge/cli functions invoke test-channel-connection --data '{
        "channelType": "sms",
        "providerAccountId": "<the-id>"
      }'
      ```
      Expect a 200 with `"status": "ok"`. A 4xx/5xx means the secret was not bound correctly — **revert immediately**, do not retry.
- [ ] **Inspect delivery events for the last 5 minutes** — no spike in `sms_delivery_events` with `status = 'failed'` or `error_code = 20003` (Twilio auth error).
      ```sql
      select provider_account_id, status, error_code, count(*)
      from sms_delivery_events
      where created_at > now() - interval '5 minutes'
      group by 1, 2, 3
      order by 4 desc;
      ```
- [ ] **Confirm the old secret is dead at the provider.** Try to authenticate against the provider with the old secret via `curl` — it should return 401 / 403. If it still succeeds, the provider did not invalidate the old key and you have a problem (see "Rollback" below).
- [ ] **Remove the old secret from the InsForge secrets store** with `npx @insforge/cli secrets remove <old-secret-id>`. Wait 60 seconds and re-run the auth check above; the old secret must now 404.
- [ ] **Write the audit log entry** — record the rotation in the `audit_logs` table (action: `secret_rotated`, resource_type: `sms_provider_account` or `email_provider_account`, metadata: `{ old_secret_id, new_secret_id, rotated_by, reason }`).
- [ ] **Notify tenants** that the rotation completed. Mark the in-app banner as resolved.
- [ ] **Delete the snapshot file** from `~/rotations/` once 24 hours have passed without incident.

---

## Per-provider rotation

### Twilio (SMS)

Twilio is the only provider that signs webhooks with the auth token, so the rotation must also update the signing secret for the inbound function. Order matters.

1. **Generate the new auth token** in the Twilio console: *Account → API keys & tokens → Auth tokens → "Request a secondary auth token"*. Twilio lets you have TWO active auth tokens during a rotation window — this is the safe path. Do **not** regenerate the primary token first; if you do, every webhook in flight 401s.
2. **Create the new InsForge secret** with the new token (JSON blob: `{"accountSid":"AC…","authToken":"<new>"}`):
   ```bash
   NEW_SECRET_ID=$(npx @insforge/cli secrets set TWILIO_CREDS_$(date +%s)='{"accountSid":"AC…","authToken":"<new-token>"}' | jq -r '.id')
   ```
3. **Update the DB row** in a single transaction. The credentials_secret_id change is what support-core reads on every send.
   ```sql
   begin;
   update sms_provider_accounts
   set credentials_secret_id = $1, updated_at = now()
   where id = $2
   returning id, provider, label;
   commit;
   ```
4. **Deploy / restart the functions** so they pick up the new resolver path. The change is hot — `sms-inbound` and `sms-status` re-resolve on every request — but a function cold-start can cache an old resolver for ~30 seconds, so a redeploy eliminates that window.
   ```bash
   npx @insforge/cli functions deploy sms-inbound --file insforge/functions/sms-inbound/index.ts
   npx @insforge/cli functions deploy sms-status --file insforge/functions/sms-status/index.ts
   npx @insforge/cli functions deploy send-reply  --file insforge/functions/send-reply/index.ts
   ```
5. **Run the test-connection function** (see Phase 3 above). Must return 200.
6. **Send a real test SMS** from a phone to the Twilio number; confirm it lands in the InboxPilot inbox.
7. **Revoke the old auth token** in the Twilio console: *Account → API keys & tokens → Auth tokens → "Revoke" on the old one*. Wait 60 seconds.
8. **Delete the old InsForge secret** with `npx @insforge/cli secrets remove <old-secret-id>`.
9. **Send a second real test SMS** to confirm everything still works after the old token is dead. If this fails, the Twilio secondary-token mechanism did not behave as documented — escalate.

> **Pitfall — Twilio webhook signature.** The `sms-inbound` function signs incoming webhooks with the *current* auth token (the one the DB row points at). If you rotated the secret but did NOT redeploy `sms-inbound`, an in-flight verifyWebhook call may have cached the old token. The redeploy in step 4 fixes this.

### Postmark (email)

Postmark does not use the server token to sign webhooks (it uses the `X-Postmark-Signature` header over the body, where the signature is the raw server token, not a hash). The rotation is simpler than Twilio — no function redeploy required, but you must update the inbound URL token in any custom DNS or proxy.

1. **Generate the new server token** in the Postmark dashboard: *Servers → (your server) → API Tokens → "Rotate server token"*. Postmark emails you the new token; the old token remains valid until you delete the old one in step 6.
2. **Create the new InsForge secret** with the new token (Postmark only needs the raw string, not JSON):
   ```bash
   NEW_SECRET_ID=$(npx @insforge/cli secrets set POSTMARK_TOKEN_$(date +%s)="$NEW_TOKEN" | jq -r '.id')
   ```
3. **Update the DB row**:
   ```sql
   begin;
   update email_provider_accounts
   set credentials_secret_id = $1, updated_at = now()
   where id = $2
   returning id, provider, label;
   commit;
   ```
4. **Restart the `email-inbound` and `email-status` functions** to clear any cached signing secret. Unlike Twilio, the signing secret is passed via the `X-Signature` header, so technically the cold start is enough — but a redeploy is cheap insurance.
   ```bash
   npx @insforge/cli functions deploy email-inbound --file insforge/functions/email-inbound/index.ts
   npx @insforge/cli functions deploy email-status --file insforge/functions/email-status/index.ts
   ```
5. **Test-connection + send a real test email** (Phase 3 checks).
6. **Delete the old Postmark server token** in the Postmark dashboard. The old token stops working immediately.
7. **Delete the old InsForge secret**:
   ```bash
   npx @insforge/cli secrets remove <old-secret-id>
   ```
8. **Send a second real test email** to confirm Postmark rejects mail signed with the old token (you will see a 401 in the dev logs — this is correct, the old signature is dead).

> **Pitfall — Postmark inbound stream.** If the tenant uses a custom inbound stream (not the default), each stream has its own server token. Repeat the rotation per stream. The query to find them all:
> ```sql
> select id, provider, label, is_active
> from email_provider_accounts
> where is_active = true;
> ```

### OpenRouter (AI)

OpenRouter is the AI gateway. The key lives in `.env.local` (dev) and the InsForge project's environment (prod), not in a per-row secret. The rotation is global — there is no per-tenant key.

1. **Generate the new API key** in the OpenRouter dashboard: *Keys → "Create new key"*. Label it `inboxpilot-2026-06-07` so it is obvious which one is current.
2. **Run `npx @insforge/cli ai setup`** — this writes the new key to the InsForge project's `OPENROUTER_API_KEY` env var, which the AI gateway reads. The CLI is interactive; expect a confirmation prompt.
3. **Restart every function that calls the AI gateway**. In practice this is `process-ai-job`, `regenerate-ai-draft`, `approve-ai-draft`, and `escalate-conversation` (the last one for the AI-handoff-summary path). The gateway is a sidecar, so the new key is picked up on the next call — but cold-start caching means a redeploy is safer:
   ```bash
   for fn in process-ai-job regenerate-ai-draft approve-ai-draft escalate-conversation; do
     npx @insforge/cli functions deploy "$fn" --file "insforge/functions/$fn/index.ts"
   done
   ```
4. **Send a test message through the inbox** end-to-end. The AI must respond. If it returns 401 from OpenRouter, the env var did not propagate — re-run `ai setup` and verify the function logs.
5. **Update the local dev `.env.local`** so the next `npm run dev` uses the same key:
   ```bash
   echo "OPENROUTER_API_KEY=$NEW_KEY" >> .env.local
   ```
6. **Revoke the old key** in the OpenRouter dashboard. Wait 60 seconds.
7. **Send a second test message** through the inbox. AI must still respond. If it does not, the gateway cached the old key — see "Rollback" below.

> **Pitfall — dev vs prod.** `.env.local` and the InsForge project's env are independent. Rotating only one means dev works and prod does not (or vice versa). Always run `ai setup` AND update `.env.local` in the same change. Document both in the audit log entry.

---

## Emergency rotation (compromise response)

If the reason for the rotation is an active compromise, skip the alerts-and-window steps. Order changes:

1. **Revoke the credential at the provider FIRST.** This is the opposite of the normal order — the goal is to close the attack window as fast as possible. The cost is a brief outage on that provider.
2. Then run Phase 2 in reverse: create the new InsForge secret, update the DB row, redeploy.
3. Then run Phase 3.
4. Then follow `docs/SECURITY_MODEL.md` incident response: audit log review, tenant notification, post-mortem.

Total elapsed time: under 10 minutes per provider, assuming you have the dashboards open.

---

## Rollback

If a step in Phase 2 fails (test-connection 4xx/5xx, webhook returns 401, AI returns 401):

1. **Stop the rotation** — do not continue. Half-rotated state is worse than the pre-rotation state.
2. **Revert the DB row** to the pre-rotation `credentials_secret_id`:
   ```sql
   update sms_provider_accounts
   set credentials_secret_id = $OLD_SECRET_ID, updated_at = now()
   where id = $ACCOUNT_ID;
   ```
3. **Redeploy the functions** so they re-bind to the old secret.
4. **Verify** with the test-connection function and a real send.
5. **Investigate the failure** before re-attempting. Common causes:
   - The new InsForge secret was created with a malformed JSON blob (Twilio).
   - The new secret has the same id as a deleted one — InsForge sometimes reuses ids; use a timestamped name.
   - The function code path does not actually call the resolver — check `providerConfig.credentialsSecretId` is set in `insforge/functions/sms-inbound/index.ts` and friends.

If rollback itself fails, escalate: page the on-call ENG-LEAD, do not improvise.

---

## Why this design (vs. rotation in place)

Some secret stores let you *change the value* of a secret without changing the id. We do not use that pattern, even when it is available. Reasons:

1. **Audit trail.** A new id is a row event (INSERT on `secrets`, UPDATE on `sms_provider_accounts.credentials_secret_id`); a value change is a silent mutation. Our `audit_logs` table is the only compliance evidence we have — silent mutations make that table useless.
2. **Concurrent reads.** During a value change, a request in flight can read the new value, the next request can read the old value (Postgres / InsForge read replicas), and the two are signed by different secrets at the same time. With a new id, the DB row update is atomic — every request after the UPDATE sees the new id and resolves the new secret.
3. **Provider semantics.** Twilio's secondary-token mechanism is the exception, not the rule — most providers do not support two-active-keys. A "new id" rotation is the universal pattern.

The cost is two extra `secrets` rows per rotation per provider. The benefit is a system that fails closed, not open, when something goes wrong.

---

## Open questions

- ⚠️ **Postmark stream tokens.** Each inbound stream has its own server token today. Should we consolidate to one token per Postmark server, accepting the lost isolation? Filed as `t_devops_postmark_stream_consolidation`.
- ⚠️ **Function warmup.** Cold-start caching of the resolver is empirically 5-30 seconds. A future change could move the resolver to a request-scoped dependency injection so the cache window is 0. Not blocking.
- ⚠️ **Multi-region.** If a second InsForge region is ever stood up, the env-var-based OpenRouter key does not replicate — each region's function must run `ai setup` independently. Tracked as a future ops task.
- ⚠️ **Cross-link to `docs/SECURITY_MODEL.md`.** This runbook assumes `SECURITY_MODEL.md` exists. As of 2026-06-07 it is a child card (`t_sec_security_model`); once that ships, the link at the top of this file will resolve. If you remove the SECURITY_MODEL child card, update this runbook's Pair-with line.

---

## Verification (was this runbook useful?)

A future maintainer can verify the runbook matches reality by running:

```bash
npm run test:rotation
```

This runs `packages/support-core/__tests__/unit/sms-provider-credential-rotation.test.ts`, which simulates a Twilio credential rotation end-to-end against an in-memory InsForge-shaped database and a fake Twilio HTTP server. If the test passes, the rotation mechanism is exercised. If it fails, either the test is stale or the support-core code drifted from the runbook — fix the one that is wrong.
