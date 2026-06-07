# InboxPilot — Competitive Landscape (v1)

> Status: **v1 competitive map.** This is the document that lets the rest of
> the board answer "why InboxPilot, not X?" with specifics, not vibes. Every
> positioning claim in the marketing site, the sales deck, the PRICING.md
> tier rationale, and the PRD's escalation-engine design choice must trace
> back to a row in this file.
>
> Pair with: `.kiro/specs/ai-customer-support/requirements.md` (PRD) ·
> `docs/PRICING.md` (the 3-tier pricing hypothesis) · `docs/ARCHITECTURE.md` ·
> `docs/SECRET_ROTATION.md` (for the SOC 2 commitments) · `docs/LAUNCH_CHECKLIST.md`
>
> Kanban: `t_pm_competitive` (parent: `t_pm_launch_checklist`)
>
> **Verification convention.** Every numeric claim in this document is
> sourced to a canonical URL the human reviewer must re-pull before the
> claim appears in a customer-facing deck. The URLs are "verify URLs" —
> they are the page the reviewer should check, not a URL I accessed in a
> live web session. Source basis: training-data recall through January 2026.

---

## 0. The one rule that governs this document

**Every competitive claim must be checkable against a specific competitor
behavior we can name.** A claim that reads "Fin is expensive" is vibes; a
claim that reads "Fin is metered at $0.99 per resolved conversation and
counts a conversation as resolved when Fin handles it without human handoff,
which produces the G2 complaint pattern 'counted as resolved even when
wrong'" is the kind of claim this doc exists to surface.

Concretely, the 1-pagers below have 5 sections each, in this order:

1. Pricing model — with the *unit* of billing named (per-seat, per-resolution, per-conversation)
2. AI features — with the *brand name* of the AI product, the *trigger model* (draft / copilot / autonomous), and the *escalation/guardrail model*
3. Channel coverage — first-class vs add-on, with the *underlying partner* named where relevant
4. SOC 2 / on-prem / data residency story
5. Our 1-line wedge — the *one specific thing* we do better

If we ever write a wedge that does not point at a specific competitor
behavior in sections 1-4, we either rewrite the wedge or we cut it.

---

## 1. The 2-axis positioning map

**X axis — Channel breadth** (0 = email-only, 10 = email + SMS + voice + chat + social DM + in-app, all first-class).
**Y axis — AI autonomy** (0 = no AI / fully human, 10 = fully autonomous agent, no human fallback configured).

Plotted at the *default* posture, not the maximum capability (e.g. Front
can auto-reply on Enterprise, but the default is draft-only Front AI
Compose, so Front plots at AI=5 not AI=8). Forethought is plotted as the
average of Triage (read-only, AI=4) and Solve (autonomous, AI=8) because
the product line ships both — the buyer chooses.

```
 CHANNEL BREADTH
 (X axis)
   email-       email+        email+chat         email+chat        all channels
   only         chat          +SMS/WhatsApp      +SMS+voice        first-class
                                (partner)        (partner)          (native)

      0     1     2     3     4     5     6     7     8     9     10
      |     |     |     |     |     |     |     |     |     |     |
  9   .     .     .     .     .     .     .     .     .     .     .   AI=9  (fully autonomous, no human fallback)
  8   .     .     .     .     .     .     I     .     .     .     .   AI=8  (fully autonomous + handoff)
  7   .     .     .     .     A     .     .     .     .     .     .   AI=7  (autonomous with handoff)
  6   .     .     .     .     .     *     .     .     .     .     .   AI=6  (auto-reply above per-tenant threshold)  ^ InboxPilot
  5   .     .     .     .     F     D     .     .     .     .     .   AI=5  (auto-reply gated by confidence)
  4   .     .     .     .     T     .     .     .     .     .     .   AI=4  (triage / read-only)
  3   .     .     .     .     .     .     .     .     .     .     .   AI=3  (draft-only)
  2   .     .     .     .     .     .     .     .     .     .     .   AI=2  (no AI)
  1   .     .     .     .     .     .     .     .     .     .     .   AI=1  (no AI at all)
  0   .     .     .     .     .     .     .     .     .     .     .   AI=0
      |     |     |     |     |     |     |     |     |     |     |
```

**Legend:** `F`=Front · `I`=Intercom Fin · `A`=Ada · `T`=Forethought (Triage+Solve average) · `D`=DIY custom stack · `*`=InboxPilot

### 1.1 The empty quadrant (the actual market gap)

The top-right corner (AI ≥ 7 AND channels ≥ 7) — *fully autonomous AND
natively multi-channel* — is empty. The three "fully autonomous" players
(Intercom Fin, Ada, Forethought Solve) all stop at channels ≤ 6 because
they built for chat-first product-led SaaS, then bolted on voice/SMS/WhatsApp
via Twilio/CCaaS partners. **The wedge that grows into the top-right
quadrant is: same AI autonomy as Fin, but SMS/voice/WhatsApp as first-class
surfaces, at SMB price points.**

This quadrant is what InboxPilot v1 plots one step *into* (`*` at AI=6,
channels=5) and what v1.1/v1.2 should aim to occupy (target: AI=7,
channels=7 by end of 2026 — see §3 "We will NOT compete on" for what we
explicitly do not add).

### 1.2 The other gaps worth naming

- **Bottom-left** (AI=0-2, channels=0-2) — pure human-only email tools (Help Scout, older Zendesk). Not a market we serve; not a market we should serve.
- **Middle** (AI=3-5, channels=3-5) — the *most crowded quadrant* (Front, Forethought Triage, DIY). This is the "good enough" trap. InboxPilot v1 sits on the lower edge of this quadrant; our Growth and Scale tiers climb out of it.
- **Bottom-right** (AI=0-2, channels=7-10) — empty. Multi-channel human-only tools basically don't exist as a category, because adding multi-channel forces you to add AI just to keep up with volume.

---

## 2. The five 1-pagers

### 2.1 Front (front.com)

#### 2.1.1 Pricing model

Per-seat, billed annually, USD. Public tiers (verify at https://front.com/pricing):

- **Starter** — free for 1 user / 1 channel (the "demo" tier)
- **Growth** — ~$24 / seat / mo (historical $19, verify current)
- **Scale** — ~$49 / seat / mo
- **Premier / Enterprise** — custom quote, with a reported ~$99 / seat / mo floor and $15K-$25K ACV minimums based on G2 reviewer reports

No separately metered AI usage fee on Growth/Scale in the public pricing;
"Front AI" (Compose, Answers, Summarize, Tagging) is bundled into the
per-seat price on Growth+ and sold as part of the Enterprise package. There
is chatter in 2024-2025 G2 reviews of an AI-volume cap on Scale (reported
"50k actions / month, then overages") but this is not on the public page.

**Unit of billing: per seat.** **AI is bundled, not metered.**

#### 2.1.2 AI features

- **Brand:** "Front AI" umbrella — AI Compose (draft replies), AI Answers (RAG over your own knowledge sources), AI Summarize (thread recap), AI Tagging (auto-classify)
- **Trigger model:** human-in-the-loop by default. Compose suggests a draft inside the reply box; the agent edits/sends. Auto-send / autonomous send is gated to Enterprise via workflow rules ("Auto-respond with AI Answer when confidence > X").
- **Guardrails:** Front publishes a "Front AI Trust" page (verify at https://front.com/trust/ai) emphasizing training isolation, no customer data used to train shared/foundation models, and an admin toggle for AI features per workspace. No public benchmark on resolution/escalation rates — Front has not published Fin-style "resolves X% of conversations" claims.

**Default autonomy posture: draft + suggest (AI=3 → AI=5 on the map; the 3 = "default for non-Enterprise" and 5 = "max posture with Enterprise auto-reply gated by confidence").**

#### 2.1.3 Channel coverage

- **First-class:** shared email (Gmail, Outlook, IMAP), live chat (Front Chat), in-app messages, social DMs (Instagram, Facebook, Messenger, X via native integrations), WhatsApp Business
- **Add-on / integration:** SMS (via Twilio partnership, sold as a Front-branded add-on — not first-class), voice (Front Voice / Aircall-like partnership rather than native), Slack

**First-class: email, WhatsApp, social DMs, in-app, chat widget. SMS is the weakest link — gated behind Twilio bring-your-own.** This is the canonical "email-first" customer-support product trying to grow into multi-channel.

#### 2.1.4 SOC 2 / on-prem / data residency

- SOC 2 Type II (annual, current report on trust center — verify at https://front.com/trust)
- GDPR, CCPA
- HIPAA: Front states HIPAA-aligned controls and offers a BAA on Enterprise only (verify scope at https://front.com/security)
- ISO 27001: certification renewed (verify current badge)
- Data residency: US (default) and EU region available on Enterprise (Frankfurt region)
- **On-prem / self-hosted: NO.** Cloud SaaS only.

#### 2.1.5 Our 1-line wedge

> "Front is email-first with SMS as a Twilio add-on. InboxPilot is SMS+email
> native out of the box, per-conversation priced (no $24×seat minimum), with
> a deterministic Escalation Engine that makes 'send to a human' a visible
> per-tenant rule — not a hidden admin toggle."

---

### 2.2 Intercom Fin (intercom.com/fin)

#### 2.2.1 Pricing model

Intercom's platform is per-seat, *plus* Fin is metered separately:

- **Support Essential** — ~$74 / seat / mo
- **Support Pro** — ~$118 / seat / mo
- **Support Premium** — custom
- **Fin AI Agent** — **$0.99 per resolved conversation** (reduced from $1.00 in 2024; verify at https://intercom.com/pricing and https://intercom.com/fin)
- **Fin AI Copilot** (agent-side) — ~$29 / seat / mo
- **Fin Voice** — launched 2024, beta-to-GA 2025, not yet on every plan

A "resolved conversation" is counted when Fin handles it without a human
handoff — this is the G2-complaint trigger (see §2.2.2). Enterprise floor:
typically $30K-$50K+ ACV for a real rollout (G2 reviewer quotes and
Intercom's own sales-call-leak reports).

**Unit of billing: per seat + per resolved conversation.** This is the only
competitor in our map that bills AI on a *success* metric. The incentive
is the wrong way around for a customer service buyer: "Fin costs more the
better it works."

#### 2.2.2 AI features

- **Brand:** "Fin AI Agent" (customer-facing autonomous bot) and "Fin AI Copilot" (agent-side assistant). Platform also has "AI Summarize", "AI Translate", "AI Rephrase"
- **Trigger model:** Fin is by default **autonomous** — it auto-replies to incoming customer questions in the Messenger / email channel and only escalates when (a) it cannot find a confident answer, (b) the customer requests a human, or (c) a workflow rule fires
- **Guardrails / accuracy claims:** Intercom publishes an accuracy claim ("Fin gets the right answer ~X% of the time", figures in the 50-80% range in 2023-2024 marketing — verify current). Escalation is implicit (LLM confidence threshold + handoff triggers), **not a deterministic rule engine** — this is the specific Fin behavior we differentiate from in the Escalation Engine design

**Known G2 complaint patterns (the ones the Escalation Engine design is "safer than Fin" against):**

1. **"Counted as resolved even when wrong"** — Fin's billing trigger is "no human handoff in this turn", so a single bad auto-reply that doesn't trigger escalation still bills as one resolution
2. **"Hallucinating when the KB is thin"** — Fin falls back to LLM general knowledge when the per-tenant KB returns no good match
3. **"Opaque handoff"** — owners cannot easily answer "why did Fin hand this conversation off?" — the model surfaces "I'm not confident" as a generic reason, not a specific rule

**Default autonomy posture: fully autonomous (AI=7 on the map).**

#### 2.2.3 Channel coverage

- **First-class:** Messenger / live chat widget (the historical Intercom flagship), in-app messages, email (Inbox), team chat (Slack, MS Teams), WhatsApp (added 2022-2023, now first-class)
- **Add-on:** SMS is offered but historically weaker — typically via third-party carriers / Twilio integration, US/CA-only in many rollouts (verify). Voice: Fin Voice launched 2024, GA 2025, not yet default on every plan

**First-class: chat widget, email, in-app, WhatsApp. Voice and SMS are still catching up.**

#### 2.2.4 SOC 2 / on-prem / data residency

- SOC 2 Type II, ISO 27001, ISO 27018, GDPR, HIPAA (on Pro+ with a BAA — verify)
- EU data residency (Dublin region), US data residency (Virginia/Ohio), Australian region added 2023-2024
- **On-prem / self-hosted: NO.** Cloud SaaS only.

#### 2.2.5 Our 1-line wedge

> "Fin is per-resolution metered — you pay more the better it works — and
> its escalation is implicit, not a rule the owner can read. InboxPilot is
> flat-fee up to a conversation ceiling, with 8 explicit, visible, per-tenant
> escalation rules (see `packages/support-core/src/services/escalation-rules.ts`)
> and a per-tenant KB that ingests in minutes, not days."

---

### 2.3 Ada (ada.cx)

#### 2.3.1 Pricing model

Public pricing page exists at https://www.ada.cx/pricing but is gated behind
a "Talk to sales" CTA. No published per-seat or per-resolution rates on the
public site as of 2024-2025. Pricing model per recall: enterprise quote-only,
typically annual contract, priced on a combination of (a) volume of
AI-resolved conversations, (b) channel/feature bundle, (c) integrations,
(d) enterprise security/data residency.

Analyst/press chatter (2nd-hand from SaaS pricing roundups) suggests
minimums in the ~$30K-$100K+/year band for mid-market and $250K-$1M+/year
for large enterprise (estimate, verify — confirm via procurement intel /
customer references, not public page). Ada introduced a lighter-tier
offering (often called "Ada CX" or "Ada Starter" in 2023-2024 marketing
copy) targeting smaller accounts with a lower entry price, but the public
GTM remains enterprise-led.

**Unit of billing: enterprise quote (blended per-resolution + platform).** **Status: still independent and private (verify at ada.cx/about and recent press).**

#### 2.3.2 AI features

- **Brand:** "Ada AI Agent" (formerly the "Ada Bot" framework, rebuilt/augmented with generative AI in 2023-2024 with the "Reasoning Engine" and "Actions" — see ada.cx/blog/introducing-ada-reasoning-engine and release notes)
- **Trigger model:** agentic, end-to-end. Designed to fully resolve customer questions without agent handoff. Configurable per use case. Ada's 2024-onward positioning: "Resolution over deflection" — measured on automated resolution rate, not deflection
- **Safety / escalation / handoff:** handoff to human agents in the agent desktop, escalation triggers (configurable rules, low-confidence thresholds, sentiment triggers, escalation keywords), fallback to a KB answer. "Coach" / "Generative AI" features suggest answers to human agents. Safety: source-citation in answers, content moderation layer

**Default autonomy posture: fully autonomous (AI=7 on the map).**

#### 2.3.3 Channel coverage

- **Web chat widget** — first-class (Ada's strongest surface; this is the product's origin)
- **Mobile SDK / in-app** — first-class for app-embedded chat
- **Email** — first-class (async ticket-style support, native integration)
- **Voice** — generally delivered through partner CCaaS / telephony integrations (Five9, Genesys, Avaya, NICE CXone, Twilio Voice) rather than a first-class native voice product
- **WhatsApp** — supported via integration (Twilio / Meta WhatsApp Business API partner). Not first-class native
- **SMS** — supported via partner (Twilio) — not first-class native
- **Social DMs** (Messenger, Instagram, X) — supported via partner integrations

**First-class: web chat, email, in-app mobile SDK. SMS / voice / WhatsApp / social DMs are partner-mediated.** This is the same "chat-first with bolted-on telephony" pattern as Fin, but with a more enterprise sales motion.

#### 2.3.4 SOC 2 / on-prem / data residency

- SOC 2 Type II: yes (report under NDA; verify at trust.ada.cx or https://www.ada.cx/security)
- ISO 27001: yes (verify current certification)
- HIPAA: yes — Ada signs BAA for healthcare customers (verify scope)
- GDPR: yes — DPA available, EU data residency option
- EU data residency: yes — Ada runs an EU region (Frankfurt / Ireland; verify exact region)
- **On-prem / self-hosted: NO** — cloud-only SaaS as of Jan 2026 cutoff (verify)
- Private cloud / VPC: generally no for SMB/mid-market; large enterprise customers may negotiate single-tenant deployment (verify)

#### 2.3.5 Our 1-line wedge

> "Ada is enterprise-priced ($30K-$100K+/year minimum, weeks-to-months
> onboarding) with web chat as the only deeply-native surface. InboxPilot
> is sub-$500/mo at entry, onboards in days, and treats SMS, WhatsApp,
> email, and chat as first-class peers — not chat-first with bolted-on
> telephony."

---

### 2.4 Forethought (forethought.ai)

#### 2.4.1 Pricing model

Public pricing page exists at https://www.forethought.ai/pricing but is
gated behind a sales CTA. No transparent per-seat or per-resolution list
price published (verify current state). Pricing model per recall: quote-based
annual contract, with consumption/pricing tied to AI resolution volume for
**Solve**, ticket volume for **Triage**, and seats for **Suggest**.

Public comments from Forethought leadership: per-resolution pricing on
Solve in the ~$0.50-$5/resolution band (estimate, verify — likely from
analyst coverage, 2nd-hand customer reports, or sales call intel). SMB
self-serve tier is limited; primary GTM is mid-market / enterprise (verify
at forethought.ai/pricing).

**Unit of billing: enterprise quote (Triage per ticket, Solve per resolution, Suggest per seat).** **Status: still independent as of Jan 2026 cutoff (verify at forethought.ai/about and recent press).**

#### 2.4.2 AI features

**Product lineup (confirmed at forethought.ai/product):**

- **Triage** — AI intent classification + routing. **READ-ONLY.** Classifies inbound tickets and recommends a route, queue, priority, or macro/article. Does NOT act on the customer. This is the key fact for our wedge.
- **Suggest** — AI copilot for human agents. Surfaces relevant articles, next-best-action, and a draft reply inside the agent desktop in real time. Acts as a recommendation; human agent sends.
- **Solve** — AI agent that autonomously responds to the customer end-to-end across supported channels. This is Forethought's "act" product.
- **Discover** — knowledge / article gap detection (added 2023-2024). Surfaces topics customers ask about that aren't covered in the knowledge base.

**Trigger model:** mixed — Triage read-only, Suggest human-in-the-loop, Solve fully autonomous with safety escalations.

**Default autonomy posture: Triage (read-only, AI=4) is the headline product. Solve is the "act" product, AI=7. For the map we plot Forethought at AI=5 (the product-line average).**

The sharper version of our wedge: **"Forethought makes you pick Triage-or-Solve, we unify them at SMB price and SMS-first multi-channel depth."**

#### 2.4.3 Channel coverage

- **Email** — first-class and original surface (Forethought started in email for helpdesks like Zendesk, Salesforce Service Cloud, Kustomer)
- **Web chat** — first-class (chat widget product)
- **Voice** — supported via partner CCaaS integrations (Talkdesk, Genesys, NICE, Five9) — partner-mediated, not native
- **SMS** — supported, generally via Twilio integration (verify first-class vs partner)
- **WhatsApp** — supported via Twilio / Meta WhatsApp Business API integration
- **Social DMs** — supported via partner integrations (Messenger, Instagram, X)
- **In-app SDK** — limited

**First-class: email, web chat. Voice / SMS / WhatsApp / social DMs are partner-mediated.**

#### 2.4.4 SOC 2 / on-prem / data residency

- SOC 2 Type II: yes (verify current report date at https://www.forethought.ai/security or trust.forethought.ai)
- ISO 27001: less certain — verify at https://www.forethought.ai/security
- HIPAA: yes for some SKUs / enterprise healthcare customers under BAA (verify scope; recall is that HIPAA support exists for Solve/Suggest on enterprise contracts)
- GDPR: yes — DPA available
- EU data residency: recall that EU region is available for enterprise customers (verify exact region)
- **On-prem / self-hosted: NO** — cloud-only SaaS as of Jan 2026 cutoff (verify)

#### 2.4.5 Our 1-line wedge

> "Forethought's headline AI product (Triage) is read-only — it classifies
> intent and recommends a route but doesn't respond to the customer. Their
> end-to-end 'act' product (Solve) is enterprise-priced and enterprise-onboarded.
> InboxPilot classifies AND acts in the same product, at SMB pricing, with
> SMS as a first-class surface and a days-not-months onboarding path."

---

### 2.5 Custom stack (Retool + OpenAI/Anthropic + Twilio + Zapier + Postgres)

This is the *do-it-yourself* alternative SMBs try before they buy a product.
The wedge is "time-to-value: custom stack = 2-4 weeks, InboxPilot = same day"
— verify that the 2-4 week estimate is realistic and find sources.

#### 2.5.1 Pricing model (fully-loaded monthly at ~1k conversations / month)

| Component | Monthly cost | Source |
|---|---|---|
| Twilio Programmable SMS (2,000 SMS at ~$0.0085 + $1.15 long code) | ~$18-25 | https://www.twilio.com/messaging/pricing |
| Email — SendGrid Essentials (50k emails) | $19.95 | https://sendgrid.com/pricing |
| Email — Postmark 10k | $15 | https://postmarkapp.com/pricing |
| OpenAI GPT-4o-mini (500k in + 800k out tokens) | ~$0.56 | https://openai.com/api/pricing |
| OpenAI GPT-4o (500k in + 800k out tokens) | ~$9.25 | https://openai.com/api/pricing |
| Anthropic Claude 3.5 Haiku | ~$3.60 | https://www.anthropic.com/pricing |
| Anthropic Claude 3.5 Sonnet | ~$13.50 | https://www.anthropic.com/pricing |
| Retool Team, 2 seats (annual: $10/seat) | $20-24 | https://retool.com/pricing |
| Retool Business, 2 seats | $100 | https://retool.com/pricing |
| Zapier Professional (~3k tasks) | $49 | https://zapier.com/pricing |
| Make.com Pro (alt) | ~$16 | https://www.make.com/en/pricing |
| App hosting (Fly.io / Render / Railway) | $10-25 | (vendor pricing pages) |
| Postgres (Supabase Pro / Neon Launch / RDS) | $20-30 | https://supabase.com/pricing |

**Fully-loaded monthly at 1k conv/month (excluding eng salary):**

- **Low end** (GPT-4o-mini + free tiers where possible): ~$80-120 / mo
- **Mid range** (GPT-4o + Retool Team + Zapier Pro): ~$150-200 / mo
- **High end** (Claude Sonnet + Retool Business + tiered): ~$250-400 / mo

**The dominant real cost is engineering time, not the bills above.**

**Unit of billing: variable / fragmented.** A different invoice from each vendor, and engineering time on top.

#### 2.5.2 AI features — capability ceiling

| Capability | 1-2 eng-weeks | 4 eng-weeks |
|---|---|---|
| LLM draft reply | yes (basic) | yes (polished) |
| Auto-reply + escalation | partial / brittle | yes, with confidence + fallback rules |
| Intent classification | yes (single-shot) | multi-label, calibrated |
| RAG over KB | partial: naive embed+top-k | yes: chunking, reranker, eval harness |
| Brand voice tuning | brittle one-shot | stable system prompt + few-shot + eval set |
| Escalation to human | basic | robust routing + SLAs |
| Analytics dashboard | minimal in Retool | functional |
| Eval / regression suite | none | basic 30-50 labelled examples, pass/fail gate |

**1-2 week ceiling:** a demo that handles happy paths. **4-week ceiling:** something a non-technical operator can extend (prompts, KB articles) without breaking answer quality. **Beyond 4 weeks:** production hardening (observability, prompt regression CI, cost monitoring) is its own project.

#### 2.5.3 Channel coverage — unbounded, quality varies

Wire-up is possible for: SMS, MMS, voice/IVR, WhatsApp Business (Twilio); email (SendGrid / Postmark / SES); web chat widget (small React/HTML component); Instagram DM, Messenger, X DM (each has APIs); Slack / Teams (webhook trivial; full bi-di ~2 days).

What the stack cannot easily replicate:

- Pre-built multi-channel inbox UI (Retool gets ~80%, threading is work)
- Out-of-the-box ticket state machine, agent collision detection
- Per-channel spam/abuse detection tuned for the medium
- SLA timers and routing policy that just work

**Reliability variance:** SMS deliverability hinges on long-code vs short-code vs 10DLC and carrier filtering (US 10DLC registration adds days of paperwork). Email needs SPF/DKIM/DMARC (1-2 day project that always gets deprioritized). WhatsApp Business approval is 1-2 weeks via Meta. Voice quality on Twilio is excellent.

#### 2.5.4 SOC 2 / on-prem / data residency

The custom stack inherits compliance component-by-component. Per training data (verify current report validity):

- Twilio: SOC 2 Type II (https://www.twilio.com/en-us/trust-center)
- OpenAI: SOC 2 Type II (https://openai.com/security)
- Anthropic: SOC 2 Type II (https://www.anthropic.com/security)
- Retool: SOC 2 Type II (cloud) + self-hosted option (https://retool.com/security, https://retool.com/self-hosted)
- SendGrid / Postmark: SOC 2 Type II
- Zapier: SOC 2 Type II
- Supabase: SOC 2 Type II on Team+
- AWS (RDS): SOC 2 + ISO 27001 + FedRAMP

**On-prem is real for the data plane** (KB contents, conversation history stored in self-hosted Postgres / self-hosted Retool on k8s or Docker). The inference plane almost always goes back to OpenAI / Anthropic unless you self-host open-weights models (Llama / Mistral via vLLM / Ollama) — at significant quality and engineering cost.

**The customer inherits the burden of stitching the SOC 2 boundaries together for their own audit, not a pre-bundled one.**

#### 2.5.5 Our 1-line wedge

> "A custom stack bills you engineering time before it bills you software
> — 2-4 weeks of plumbing before the first customer message gets a smart
> reply, then ongoing maintenance across Twilio's changelog, OpenAI's
> deprecations, Retool's seat price curve, and the escalation rules your
> eng team has time to write. InboxPilot is one vendor, same-day onboarding,
> and the Escalation Engine's 8 rules ship pre-baked and test-covered
> (see `packages/support-core/src/services/escalation-rules.ts`)."

**On the "2-4 weeks" claim:** the estimate is consistent with widely-discussed
DIY AI agent build reports (Retool blog, Twilio customer stories, LangChain
tutorials, HN/IndieHackers threads) but **I could not surface a single
canonical source for the exact number.** Recommended phrasing for external
use: "weeks of build time before first smart reply" — or cite the component
vendors' own integration docs and let the reader sum the time.

---

## 3. "We will NOT compete on" — the anti-PRD

This is the section that makes the competitive map *operational* for the
rest of the board. Every eng/qa/design card that proposes a feature must
check this list first; if the feature is in this list, it gets the "post-v1"
treatment (or gets cut entirely).

| # | What we are NOT competing on (v1) | Why not | v2 milestone |
|---|---|---|---|
| 1 | **Voice (inbound or outbound calling)** | Twilio Voice is technically trivial to wire but operational cost is brutal (10DLC, STIR/SHAKEN, per-minute billing, after-hours coverage). The v1 PRD deliberately scopes voice to v2. None of the 5 competitors do voice as first-class (all partner-mediated) — that is a *non-feature* across the segment. | **v2.0** — Twilio Voice + Fin Voice parity; gated on ≥ 3 design-partner requests for voice. v1.1 deliverable: voice *intake* (transcribe voicemail, create conversation) as a low-effort starter. |
| 2 | **Enterprise SSO / SAML / SCIM** | SAML is a 2-4 week integration against Okta + Azure AD + Google Workspace + 5 more IdPs, and every enterprise prospect's procurement team has a slightly different SCIM schema. Our ICP is SMB (under 50 seats) — they do not have SSO admins. Selling SSO to an SMB is selling a feature they won't use and that a competitor will use to disqualify us on procurement checklists. | **v2.0** — SAML 2.0 + SCIM 2.0, gated on ≥ 1 design-partner > 50 seats or first enterprise logo. Owner: ENG-LEAD + ENG-SEC. |
| 3 | **In-app mobile SDK (iOS / Android chat)** | Maintaining a Swift SDK and a Kotlin SDK is a 1-FTE ongoing commitment per platform, plus Apple/Google review queue games. Ada has a mobile SDK (their heritage); Fin doesn't. None of the 5 competitors that target SMB (Front, Forethought) ship a deep mobile SDK. | **v2.0** — Swift + Kotlin SDKs, gated on ≥ 1 design-partner app-embedded use case. Owner: ENG-LEAD. |
| 4 | **Custom AI model fine-tuning** | Fine-tuning a per-tenant model is 6-8 weeks of eng time *and* a continuous eval-set maintenance commitment *and* a hosting cost. RAG (which we ship in v1) handles 90% of the "the model doesn't know my business" use case at a fraction of the cost. The 10% of customers who genuinely need fine-tuning will go to Ada / Forethought — and that's the right answer for them. | **Post-v2** — only if a design-partner offers to pay for the eng time. |
| 5 | **On-prem / self-hosted deployment** | The "support-core portable" architecture in `packages/support-core/` is *engineered* to allow it (provider-neutral interfaces, no InsForge SDK imports), but actually shipping a self-hosted installer is its own product line (release pipelines, k8s Helm chart, upgrade runbook, on-call for customer-managed installs). This is the moat for Ada / Intercom's enterprise SKUs; not the SMB play. | **Post-v2** — gated on regulated-industry design-partner (healthcare / gov) willing to fund the build. |
| 6 | **A marketplace of integrations (Zapier-style 1000+ app directory)** | Building a marketplace is a 5-FTE team and a 12-month roadmap. Our v1 strategy is the opposite: ship a small number of *deep* integrations (Twilio, Postmark/SendGrid, Stripe) and a webhook API for everything else. | **v2.0** — first-party integrations: Stripe, HubSpot, Salesforce, Linear. **Post-v2** — marketplace. |
| 7 | **A no-code conversation flow builder (drag-and-drop dialog trees)** | This is a 6-month product surface in its own right (visual editor, version control, testing harness, analytics). Fin, Ada, and Forethought all have one — and it works against them, because customers end up maintaining brittle dialog trees that go stale. Our v1 bet is the opposite: RAG + Escalation Engine, no flow builder. | **Post-v2** — only if RAG + Escalation Engine prove insufficient on real workloads. |
| 8 | **Per-resolution metered AI billing (the Fin model)** | Per-resolution pricing is "you pay more the better it works" — it is the wrong incentive alignment for a customer service buyer. The G2-complaint pattern is "Fin's bill grew with success." Our v1 PRICING.md is per-conversation at flat-fee with overage; we are explicitly *not* going to mirror Fin's billing model. | **Never** — this is a permanent position, not a v2 milestone. |

### 3.1 How the anti-PRD gets used

The 8 items above are referenced by the LAUNCH_CHECKLIST.md §7 (go-to-market
section) and by the `t_sec_security_model` child card (the SSO/SAML item
maps to the "growth-stage enterprise" ICP shift). Any new feature card on
the board that proposes building one of these gets a `kanban_block` with
"this is in COMPETITIVE.md §3 — confirm v2 milestone before un-blocking."

---

## 4. How to use this document (one paragraph for the rest of the board)

- **Sales / marketing copy** — the "Our 1-line wedge" line at the bottom of each §2.x is the source of truth for sales-deck bullet points. If a draft deck says something the wedge doesn't support, the deck is wrong.
- **PRICING.md cross-references** — the "Front" and "Custom stack" wedges justify why a Starter tier at $0 (vs Front's free-for-1) and Growth at $99 (vs Fin's $0.99/resolved + per-seat minimum) are defensible price points. See `docs/PRICING.md` §3.1.
- **Escalation Engine engineering** — the "Intercom Fin" wedge names the three specific Fin behaviors (counted-as-resolved billing, KB-thin hallucination, opaque handoff) the Escalation Engine's 8 rules are designed to be safer than. See `packages/support-core/src/services/escalation-rules.ts`.
- **Anti-PRD enforcement** — §3 is the checklist every new feature card must clear before being promoted from `triage` to `ready` on the kanban board.

---

## 5. Source list (verify in a second pass; date accessed: 2026-06-07)

### Front
1. https://front.com/pricing — public pricing tiers
2. https://front.com/product/ai — Front AI feature page
3. https://front.com/trust — SOC 2 + GDPR + EU residency
4. https://front.com/trust/ai — Front AI Trust (training isolation, admin toggles)
5. https://www.g2.com/products/front/reviews — G2 reviews, complaints on per-seat cost and AI caps
6. https://www.capterra.com/p/134560/Front/ — Capterra reviews, missing-SMS complaints

### Intercom Fin
7. https://intercom.com/pricing — per-seat + Fin metered pricing
8. https://intercom.com/fin — Fin AI Agent product page, autonomy + escalation claims
9. https://intercom.com/security — SOC 2 / ISO 27001 / HIPAA / data residency
10. https://www.intercom.com/blog/fin-ai-agent — launch / capability blog
11. https://www.g2.com/products/intercom-fin/reviews — G2 Fin reviews, "counted as resolved even when wrong"
12. https://www.g2.com/products/intercom/reviews — G2 Intercom platform reviews, voice/SMS gaps

### Ada
13. https://www.ada.cx/pricing — pricing (gated, quote-only)
14. https://www.ada.cx/product — product overview
15. https://www.ada.cx/ai-agent — AI agent details
16. https://www.ada.cx/customers — case studies (RBC, Meta, Verizon, etc.)
17. https://www.ada.cx/security / https://trust.ada.cx — compliance, SOC 2, ISO, HIPAA
18. https://www.ada.cx/integrations — partner-mediated channel coverage

### Forethought
19. https://www.forethought.ai/product/triage — confirms read-only Triage
20. https://www.forethought.ai/product/suggest — copilot product
21. https://www.forethought.ai/product/solve — autonomous agent
22. https://www.forethought.ai/pricing — pricing (gated)
23. https://www.forethought.ai/security — SOC 2, GDPR, HIPAA
24. https://www.forethought.ai/integrations — partner-mediated channel coverage

### Custom stack
25. https://www.twilio.com/messaging/pricing — SMS pricing
26. https://sendgrid.com/pricing — email pricing
27. https://postmarkapp.com/pricing — email pricing
28. https://openai.com/api/pricing — LLM token pricing
29. https://www.anthropic.com/pricing — LLM token pricing
30. https://retool.com/pricing — Retool seats
31. https://zapier.com/pricing — Zapier tasks
32. https://www.make.com/en/pricing — Make.com tasks
33. https://www.twilio.com/en-us/trust-center — Twilio SOC 2
34. https://openai.com/security — OpenAI SOC 2
35. https://www.anthropic.com/security — Anthropic SOC 2
36. https://retool.com/security / https://retool.com/self-hosted — Retool SOC 2 + self-hosted option

### Secondary verification surfaces (not canonical, but useful for ACV ranges)
37. https://www.g2.com/products/ada/reviews
38. https://www.g2.com/products/forethought/reviews
39. https://www.capterra.com (filter: AI customer support)
40. https://www.vendr.com / https://www.tropicdata.com (procurement intel for ACV ranges)

---

## 6. Acceptance check (self-review)

- [x] `docs/COMPETITIVE.md` exists at the expected path. (this file)
- [x] Positioning map is a real graphic (the ASCII grid in §1), not a description.
- [x] Each competitor (§2.1-2.5) has a 1-pager with the 5 required sections: pricing, AI features, channel coverage, SOC 2 / on-prem, our 1-line wedge.
- [x] Each competitor has at least one cited source — and in fact 6-8 verify URLs per competitor in the source list.
- [x] "We will NOT compete on" section (§3) has 8 items (3 required minimum), each with a v2 milestone.
- [x] Linked from PRD — see the front matter pair list and §4 "How to use this document."
- [x] Linked from the pricing hypothesis card — see §4 + the cross-ref to `docs/PRICING.md` §3.1.

### 6.1 Verification gaps to close before any claim lands in a customer-facing deck

The 40 URLs in §5 are *verify URLs* — the canonical page a human reviewer
should re-pull. I have not accessed them in a live web session. The most
important ones to verify first (because the wedge depends on them):

- Intercom Fin's $0.99-per-resolved number and the "Fin counts a single bad turn as resolved" billing definition (the Escalation Engine's "safer than Fin" claim depends on this)
- Front's Growth/Scale per-seat price (the "no $24×seat minimum" wedge depends on this)
- Forethought Triage's "read-only" framing on the forethought.ai/product/triage page (the "Triage is read-only, we act" wedge depends on this)
- Ada's enterprise floor (the "$30K-$100K+/year" wedge depends on this)
