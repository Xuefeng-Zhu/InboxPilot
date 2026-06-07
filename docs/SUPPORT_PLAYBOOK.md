# InboxPilot — Tier-1 Support Playbook

**Version:** 0.1.0 (pre-launch draft)
**Owner:** PM (Founders are Tier 1 in v1 — see §3)
**Last updated:** 2026-06-07
**Status:** Drafted for first 5 design-partner tenants. Review before shipping to inboxes.

> **How to use this doc.** When a tenant emails `support@inboxpilot.com`, the responder reads the matching FAQ answer first, then copies the 1-2 sentence reply. If none of the FAQs match (or the issue is a real bug), walk the §3 escalation path. The §4 tone guide applies to *every* reply, even short ones.

---

## Table of contents

1. [FAQ](#1-faq)
2. [Known issues](#2-known-issues)
3. [Escalation path](#3-escalation-path)
4. [Tone & voice](#4-tone--voice)
5. [Out of scope](#5-out-of-scope)
6. [Change log](#6-change-log)

---

## 1. FAQ

> 25 entries grouped by topic. Each answer is the minimum we can confidently say in v1. Where we have a deeper doc, we link to it. Where we don't, the link is a `[TODO: doc to be written]` placeholder — file a follow-up if you actually need it during a customer interaction.

### Pricing & billing (5)

**Q1. How much does InboxPilot cost?**
InboxPilot is **free during the closed beta** for the first 5 design-partner tenants. Pricing for the post-beta tier has not been published. Reply with: "Pricing for the general tier will be published when we exit beta. As a design partner you'll get at least 30 days notice and locked-in beta pricing for the first year." `[TODO: pricing doc]`

**Q2. How do I add more seats to my organization?**
Seats are added in **Settings → Members → Invite**. Owners and admins can invite; agents and viewers cannot. Each invite consumes one seat from your plan's seat quota. During the beta, seat counts are uncapped — reply with: "I just invited them — they should get an email in the next few minutes. If it doesn't arrive, check spam for a message from `noreply@insforge.app`." See [`docs/DEVELOPMENT.md`](./DEVELOPMENT.md) for the role definitions (Owner / Admin / Agent / Viewer).

**Q3. What's the difference between Owner, Admin, Agent, and Viewer?**
Owner = billing + member management. Admin = everything except billing. Agent = inbox + knowledge base, no member management. Viewer = read-only. The full role matrix is in [`docs/DATABASE.md` §organization_members](./DATABASE.md#2-organization_members). Reply with the matrix link and a one-line "what they probably want" recommendation based on what the user said.

**Q4. Can I get an invoice / receipt?**
We don't have a self-serve invoice flow yet. Reply: "I can email you a PDF invoice generated from our billing system. Reply with the billing email and company name you'd like on it and I'll send it within one business day." `[TODO: billing/invoice flow]`

**Q5. Do you offer annual billing / non-profit / startup discounts?**
Not in beta. After beta, we'll publish a pricing page that includes these. Reply: "We're not running discount programs during the closed beta. I'll let you know when post-beta pricing is available." Don't promise anything — flag the conversation for the founders.

### Messaging — SMS (5)

**Q6. Why didn't my SMS send?**
The three most common causes, in order:
1. **No SMS provider configured for your org.** Go to Settings → Channels → SMS — if it says "Not configured," that's the issue. See [`docs/API.md` §test-channel-connection](./API.md).
2. **Recipient opted out.** Opt-outs are honored immediately and persist in the `contacts.metadata.opt_out_sms` flag. Once opted out, we will not deliver further SMS to that number from any agent in your org.
3. **Twilio/Telnyx webhook misconfigured.** The provider is rejecting the send. Check the provider's dashboard for the error code (common: 21211 = invalid 'To' number, 21408 = permission to send to region not enabled).

Reply with these three causes, ask which one the customer has already ruled out, and don't speculate further.

**Q7. What SMS numbers do messages come from?**
Beta tenants use a shared long-code pool managed by InboxPilot; you cannot pick a number in v1. After beta we'll offer number provisioning. Reply: "All beta SMS go out from InboxPilot's shared long-code pool. We don't expose number selection during the closed beta."

**Q8. Do you support MMS / images / group texts?**
Not in v1. We support plain SMS (160-char segments, GSM-7 encoding), inbound and outbound. Reply: "Image/MMS support is on the roadmap but not in the current beta. If you have an urgent need, let me know and I'll flag it for the team."

**Q9. Why are some SMS arriving late or out of order?**
Carrier latency, not us. SMS has no delivery SLA. Inbound messages can arrive seconds-to-minutes after the sender hits send. We log the provider-reported timestamp on every message. If the customer needs timestamps, point them at the conversation detail view in the inbox UI.

**Q10. Can I send SMS internationally?**
Only to US/CA numbers in the beta. International support is on the roadmap. Reply: "We support US and Canadian numbers in the current beta. International rollout is on the roadmap — I'll note your interest and follow up when we expand coverage."

### Messaging — Email (3)

**Q11. How do I set up email (Postmark) inbound?**
In Settings → Channels → Email, paste the Inbound Hook URL Postmark gives you into the InboxPilot field (or vice versa — see the on-screen instructions). After it's wired, send a test email to the address Postmark assigned you. Reply with the on-screen instructions link and offer to screenshare if they're stuck.

**Q12. Why are my outbound emails going to spam?**
Three things to check, in order: (1) SPF/DKIM/DMARC records on the customer's *reply-to* domain if they're using a custom domain, (2) Postmark's sender reputation dashboard, (3) the message body — links to newly-registered domains or heavy HTML can hurt deliverability. Reply: "This is almost always a DNS or sender-rep issue on the sending side. Can you confirm the SPF/DKIM records on your domain? If you want, paste them and I'll sanity-check them."

**Q13. Why did an inbound email show up twice?**
Most likely cause: a forwarding rule on the customer's mailbox that forwards to the InboxPilot inbox *and* sends the original. We de-dupe on the Postmark `MessageID` header, so if the forwarded copy has a different MessageID it will appear twice. Reply: "This usually means the original mailbox is forwarding to us. Disable the forwarding rule on the mailbox and the dupes will stop."

### Channels, credentials & security (4)

**Q14. How do I rotate my Twilio / Telnyx / Postmark credentials?**
Go to Settings → Channels → select the provider → "Rotate credentials." Paste the new credential and click "Test connection." The new credential is encrypted at rest (per [`docs/ARCHITECTURE.md` §Security](./ARCHITECTURE.md)) and the old one is invalidated within 60 seconds. If "Test connection" fails, the old credential remains active — your messages will keep flowing on the old cred until the test passes. Reply with that flow and a "let me know if the test fails" follow-up offer. The internal team-rotation procedure (e.g. for a forced provider rotation) is documented in [`docs/SECRET_ROTATION.md`](./SECRET_ROTATION.md) — tenants never see that doc, only the in-app flow above.

**Q15. Where do I find the audit log?**
Settings → Audit Log. Every significant action (login, message sent, channel rotated, member added, knowledge doc uploaded, escalation triggered) is logged with actor, timestamp, target, and outcome. Logs are append-only — see [`docs/DATABASE.md` §audit_logs](./DATABASE.md#17-audit_logs). Reply with the link and the column names they probably care about (`actor_user_id`, `action`, `target_type`, `created_at`).

**Q16. Can I export my data?**
Yes — Settings → Export. Exports are JSON (db schema mirror) or CSV (conversations + messages). The export is generated asynchronously; you'll get an email with a download link (expires in 7 days). Reply: "Exports live in Settings → Export. The link is good for 7 days — download it when you get the email."

**Q17. How do I delete my account / org?**
Email `support@inboxpilot.com` from the address on file. We confirm via that channel (to prevent an attacker with a stolen session from deleting an account), then schedule deletion. All data is purged within 30 days; an audit-log entry persists for 7 years per the DPA. See [`legal/DPA.md`](../legal/DPA.md) §10.

### AI & knowledge base (4)

**Q18. Why is the AI giving a wrong / out-of-date answer?**
Two common causes: (1) the relevant knowledge base doc isn't uploaded yet, or (2) the doc *is* uploaded but the embedding hasn't been generated (check the doc's status — should be `ready`, not `processing` or `failed`). Reply: "Can you check the document's status in the Knowledge page? If it's `ready` and the answer is still wrong, paste the customer's question and the doc you expected it to use and I'll dig in."

**Q19. Why did a conversation escalate instead of being auto-replied?**
The escalation engine runs *before* the LLM and looks for deterministic signals: profanity, legal threats ("I'll sue"), safety concerns (self-harm, threats of harm to others), payment disputes ("chargeback"), and a small list of customer-configured phrases. Escalation is not an LLM judgement call — it's a rules engine. The full rule list is in [`docs/ARCHITECTURE.md` §Escalation](./ARCHITECTURE.md). Reply: "Escalation is a deterministic rule, not an LLM decision — the rule that triggered should be in the conversation's `escalation_reason` field. Want me to look at the specific conversation?"

**Q20. Can I disable AI for some conversations / contacts?**
Yes — per-conversation toggle in the inbox ("Pause AI on this thread"), and per-contact (set `contacts.metadata.ai_disabled = true`). Reply: "Yes — there's a per-conversation toggle in the inbox, and a per-contact flag in the contact's metadata. Want me to walk you through either?"

**Q21. How do I add a document to the knowledge base?**
Drag-and-drop on the Knowledge page, or paste text. See [`docs/design/index.html`](./design/index.html) for the full upload flow (queued → uploading → processing → ready → failed). Reply with the design link and offer to screenshare.

### Account, login & general (4)

**Q22. I can't log in. What do I do?**
Three things in order: (1) reset password from the login page, (2) check that the email is the one used at signup (InsForge auth is email-keyed, not username), (3) check that the org wasn't deleted (Owner can confirm in their email). If none of those resolve it, escalate to Tier 2 — see §3.

**Q23. How do I change my email / merge accounts?**
Email-only identity is locked for the beta. Reply: "Email is locked during the closed beta for security. I'll note the requested change and follow up when we open account migrations (target: post-beta)."

**Q24. Is there a status page?**
Not yet. We post incident updates to `status@inboxpilot.com` (or to your shared Slack channel if you've been onboarded onto one). Reply: "We don't have a public status page yet — for the beta, we'll email you directly for any incident that affects you. If you'd like a shared Slack or Teams channel for incident comms, say the word."

**Q25. What's on the roadmap?**
Reply: "I'll send you the most recent roadmap doc — it's a living document, so what you get is current as of today." `[TODO: link to roadmap doc]` Don't speculate about specific ship dates; refer to "current quarter" / "next quarter" if pushed.

---

## 2. Known issues

> **Empty at launch — this is the goal, not an oversight.** We want this section to be empty on day one. Any issue we cannot fix within 48 hours of being reported goes here with a status and ETA. The rule: **if it's been more than 48h, it belongs in this section, not in someone's head.**
>
> When the first known issue lands, replace this paragraph with the table below and update §6 (change log).

| ID | Title | Reported | Severity | Status | ETA | Owner |
|---|---|---|---|---|---|---|
| — | _No known issues at launch._ | — | — | — | — | — |

### How to add an entry

1. Create a row with the next sequential `KI-001`, `KI-002`, … id.
2. **Severity**: `Sev1` (production broken for all tenants) / `Sev2` (broken for some tenants, workaround exists) / `Sev3` (cosmetic / minor).
3. **Status**: `Investigating` → `Fix in progress` → `Monitoring` → `Resolved`.
4. **ETA**: when we expect a fix or a workaround. If we genuinely don't know, write "TBD" and set a follow-up to revisit in 7 days.
5. **Owner**: who's driving it.
6. Link the row to the engineering ticket (or the kanban card id, e.g. `t_eng_*`).

### SLA reminder (v1)

- **Sev1** — we acknowledge in 1 hour, fix or workaround in 24h.
- **Sev2** — acknowledge in 4 business hours, fix or workaround in 5 business days.
- **Sev3** — acknowledge in 1 business day, fix in next maintenance window.

These are *target* SLAs, not contracts. They are not in any signed document with tenants; treat them as the bar we hold ourselves to.

---

## 3. Escalation path

> **In v1, Tier 1 is the founders and the PM, period.** Tier 2 is engineering on a rotation. Tier 3 is founder-level for legal and security. The names below are the people currently on the rotation. Update §6 (change log) whenever the rotation changes.

### Tier 1 — First responder (the founders + PM, during beta)

| Role | Person | Contact | Hours |
|---|---|---|---|
| Primary on-call (rotating weekly) | `[TODO: assign — TBD at launch]` | `support@inboxpilot.com` (shared inbox) | Mon–Fri 9a–6p local; weekend best-effort |
| Backup on-call | `[TODO: assign — TBD at launch]` | same | same |
| PM (escalation review) | `[TODO: assign — TBD at launch]` | `pm@inboxpilot.com` | Mon–Fri |

> **Action**: read the matching FAQ, send a reply within **4 business hours** (target SLA in v1). If unresolved, escalate to Tier 2 *and* drop a note in `#support-tier1` (or whatever channel exists by then) so context doesn't live in one inbox.

### Tier 2 — Engineering on rotation

| Role | Person | Contact | Hours |
|---|---|---|---|
| Eng on-call (rotating weekly) | `[TODO: assign at launch — eng team will own]` | `eng-oncall@inboxpilot.com` | Mon–Fri business hours; Sev1 page 24/7 |
| Eng on-call backup | `[TODO: assign at launch]` | same | same |

> **When to escalate from Tier 1 → Tier 2**: any issue that involves (a) production data, (b) suspected bug, (c) a code/config change, or (d) anything you can't resolve by following the FAQ. Hand off with: customer org name, conversation id, what you tried, what you observed.
>
> **Don't escalate** for: how-to questions, billing questions, account-management questions. Those stay at Tier 1.

### Tier 3 — Founder-level (legal, security, contractual, breach, abuse)

| Role | Person | Contact | When to involve |
|---|---|---|---|
| Founder on legal & contracts | `[TODO: assign at launch]` | `legal@inboxpilot.com` | Anything referencing the DPA, MSA, AUP, redlines, indemnification, GDPR, CCPA, sub-processors, or a request to sign anything. |
| Founder on security & incidents | `[TODO: assign at launch]` | `security@inboxpilot.com` | Anything that smells like a security incident, a vulnerability report, a suspected breach, an unauthorized access event, an account takeover, or a law-enforcement request. |
| Founder on trust & abuse | `[TODO: assign at launch]` | `trust@inboxpilot.com` | AUP violations, content abuse, threats from one tenant toward another, or law-enforcement subpoenas. |

> **Always page Tier 3 in parallel with Tier 2 for**: any suspected security incident (do not wait for confirmation; the IR runbook — `t_sec_incident_response` — covers the steps), any contact from law enforcement or a regulator, any press inquiry. The `security@inboxpilot.com` inbox is monitored 24/7 during the beta; if you can't reach anyone, email it and a founder will pick it up.

### Escalation cheat-sheet

| Symptom | Tier |
|---|---|
| "How do I…", "Where is…", "Can I…" | **Tier 1** (PM/founders) |
| Login issue, account merge, billing export | **Tier 1** |
| Suspected bug, broken behavior, missing feature | **Tier 1 → Tier 2** |
| Production data issue, code/config question | **Tier 1 → Tier 2** |
| DPA, MSA, AUP, redlines, GDPR/CCPA question | **Tier 1 → Tier 3 (legal)** |
| Vulnerability report, suspected breach, account takeover | **Tier 1 → Tier 3 (security) — page immediately** |
| AUP violation, content abuse, law-enforcement contact | **Tier 1 → Tier 3 (trust)** |
| Press inquiry, public statement request | **Tier 1 → any founder** |

---

## 4. Tone & voice

> The short version. This applies to *every* reply, even a one-line "I just did X for you." In v1, every reply is from a named person (or "The InboxPilot team") — never from a generic no-reply address.

### The four rules

1. **Respond within 4 business hours.** Even if the answer is "we're looking into it." Silence is the worst tone.
2. **Never blame the customer.** "You didn't configure X" → "It looks like X needs to be configured — here's how."
3. **Never say "this is by design" without a workaround.** "It's by design" with a workaround is fine. Without one, it sounds like a brush-off.
4. **Always end with a next step.** Either a question ("does that work?"), an action ("I'll follow up by EOD Thursday"), or a hand-off ("I've looped in X — they'll be in touch by …").

### Do / don't — 7 examples

| # | Don't write | Do write | Why |
|---|---|---|---|
| 1 | "This is by design." | "The reason X behaves that way is Y (so it doesn't Z). If Y is a problem for you, here's a workaround: … — want me to apply it?" | The "don't" is a brush-off. The "do" explains the trade-off and offers a path forward. |
| 2 | "You didn't set up Twilio correctly." | "It looks like the Twilio credentials aren't configured yet — that explains the 401. Go to Settings → Channels → SMS and paste your Account SID + Auth Token. Want to screenshare if it's not working?" | The "don't" blames the user. The "do" diagnoses and offers help. |
| 3 | "We'll get back to you." | "I'll follow up by Thursday EOD with an update — and if I don't, ping me at pm@inboxpilot.com." | The "don't" is open-ended. The "do" is a commitment with an escape hatch. |
| 4 | "Per our terms of service…" | "Per our AUP (linked), that use case isn't supported. The closest thing that *is* supported is X — would that work for you?" | The "don't" hides behind a contract. The "do" is direct and offers an alternative. |
| 5 | "I don't know." | "I don't know off the top of my head — let me check with engineering and get back to you by tomorrow morning." | "I don't know" alone is a dead end. Paired with a follow-up, it's honest. |
| 6 | "That's a known issue, sorry for the inconvenience." | "Yes — that's KI-003 (linked). It's in our queue with an ETA of next Wednesday; I'll update you if it slips. In the meantime, the workaround is X." | The "don't" is vague. The "do" names the issue, gives an ETA, and offers a workaround. |
| 7 | "Thanks for reaching out!" | "Hi {name} — saw your note about {thing}. {Answer or first action}. {Next step / question}." | The "don't" is filler. The "do" proves we read the email and gives them something to act on. |

### Style details

- **Greeting**: "Hi {first name}," not "Dear Customer" or "Hello there."
- **Sign-off**: "— {your name}, InboxPilot" or "— The InboxPilot team" (use the team sign-off if the reply is from a shared inbox).
- **Length**: aim for 3–6 sentences for a first reply. Longer is fine if the answer needs it; shorter is fine if the issue is trivial.
- **Format**: short paragraphs, one blank line between them. Bullet lists for steps. Code blocks for IDs / snippets.
- **Emoji**: none in support emails. Slack DMs are different.
- **Pronouns**: ask if you're guessing. Don't assume.
- **Apologies**: apologize for the impact, not for being contacted. "Sorry you're hitting this" ≠ "Sorry for the inconvenience."

### What we never say

- "Calm down."
- "As I mentioned…"
- "Per my last email."
- "It should just work."
- "Just" anything ("just click here", "just configure", "just submit a ticket").
- "Unfortunately…" as the first word of a paragraph.
- "We're not a fit for you." (If a customer is genuinely off-platform, say so warmly and offer to refer.)

---

## 5. Out of scope

The following are intentionally not in this doc and are owned by other cards or by external counsel:

- **The click-wrap support flow / in-product help widget.** Owned by `t_design_*` cards.
- **The SLA / uptime guarantees that go into the MSA.** Those are contractual; this doc is operational. See the MSA template when it lands.
- **The security model / incident response runbook.** Owned by `t_sec_security_model` and `t_sec_incident_response`. The escalation path in §3 references them but does not duplicate them.
- **The IR runbook's specific breach notification clock (72h).** Owned by `t_sec_incident_response`. The §3 escalation here says "page immediately" and points at the IR runbook.
- **The status-page product / public uptime reporting.** Not in scope for v1; see Q24.
- **The self-serve invoice flow.** See Q4 placeholder.
- **The pricing page.** See Q1 placeholder.

---

## 6. Change log

| Version | Date | Author | Notes |
|---|---|---|---|
| 0.1.0 | 2026-06-07 | pm (kanban `t_ops_support_handoff`) | First draft. All sections present, FAQ has 25 entries, known-issues empty by design, escalation roles marked `[TODO: assign at launch]`. Pre-customer. |

> **Reminder**: every change to the FAQ, the escalation path, or the tone rules goes in the change log. The "do/don't" examples especially — those evolve as we see what tenants actually push back on.
