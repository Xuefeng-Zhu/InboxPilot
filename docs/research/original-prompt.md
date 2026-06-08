You are a senior full-stack engineer, AI systems architect, and product-minded builder.

Build a working MVP of a Delight AI-like customer support system for SMS and email using InsForge as the backend platform, while keeping the core product portable so it can migrate away from InsForge later if needed.

Main goal:
Create an AI customer support platform where a business can connect SMS and email channels, receive customer messages in a shared inbox, generate AI support replies from a knowledge base, approve AI drafts, auto-reply when safe, escalate to humans when needed, and maintain a full conversation/ticket history.

Important architectural decision:
Use InsForge for the MVP backend primitives, but do not hard-code the product around InsForge.

Use InsForge for:
- PostgreSQL database
- Auth
- Row-level security
- Auto-generated APIs
- Serverless functions
- Secrets
- Realtime updates
- Storage, if needed
- pgvector
- AI gateway, if available and appropriate

Do not build a separate custom Express/Fastify/Nest backend for the MVP unless absolutely necessary.

However, keep business logic portable:
- SMS logic should live in provider-neutral adapters.
- Email logic should live in provider-neutral adapters.
- AI logic should live in a reusable package.
- Queue logic should live behind a JobQueue interface.
- Repository/data-access code should be wrapped so the frontend and core services are not scattered with raw InsForge assumptions.
- InsForge Functions should be thin entrypoints that call portable services.

Before coding:
1. Fetch and read the latest InsForge docs.
2. Fetch https://insforge.dev/skill.md if available.
3. If InsForge MCP is available, use it to fetch current docs and project context.
4. Do not guess InsForge CLI, SDK, function deployment, RLS, auth, storage, AI, realtime, or pgvector behavior if docs/tools are available.
5. Ask me only for genuinely required credentials or project connection details, such as InsForge project URL, anon key, service/admin key, and provider API keys.

Build a real working MVP, not a mock-only prototype.

Recommended frontend stack:
- Next.js
- React
- TypeScript
- Tailwind
- @insforge/sdk
- InsForge Auth

Recommended backend structure:
- InsForge SQL migrations
- InsForge Functions
- InsForge Postgres tables
- InsForge Realtime
- InsForge pgvector
- InsForge Storage only if attachments are needed
- Database-backed jobs table for background work

Do not use:
- Prisma
- Drizzle
- Redis/BullMQ for the MVP
- A custom backend server as the main backend
- Twilio-only SMS logic
- One-off provider-specific email logic
- Platform-specific AI logic embedded directly in webhook functions

The system should be designed as:

Next.js frontend
→ InsForge Auth
→ InsForge Postgres
→ InsForge Functions
→ portable support-core package
→ provider-neutral SMS/email adapters
→ provider-neutral AI/retrieval package
→ Postgres-backed support_jobs table
→ InsForge Realtime for inbox updates

Suggested repo structure:

apps/web
  app
    inbox
    knowledge
    settings
    analytics
    login
  components
  lib
    insforgeClient.ts
    auth.ts
    realtime.ts
    repositories
      conversations.ts
      messages.ts
      contacts.ts
      knowledge.ts
      settings.ts
  features
    inbox
    knowledge
    settings
    analytics

insforge
  sql
    001_schema.sql
    002_indexes.sql
    003_rls.sql
    004_pgvector_rpc.sql
    005_realtime.sql
    006_seed.sql
  functions
    sms-inbound
      index.ts
    sms-status
      index.ts
    email-inbound
      index.ts
    email-status
      index.ts
    send-reply
      index.ts
    approve-ai-draft
      index.ts
    regenerate-ai-draft
      index.ts
    process-ai-job
      index.ts
    process-knowledge-document
      index.ts
    process-jobs
      index.ts
    escalate-conversation
      index.ts
    resolve-conversation
      index.ts
    reopen-conversation
      index.ts
    test-channel-connection
      index.ts

packages
  support-core
    contacts.ts
    conversations.ts
    messages.ts
    escalation.ts
    audit.ts
    types.ts
  channels
    sms
      types.ts
      providerFactory.ts
      providers
        mock.ts
        twilio.ts
        telnyx.ts
        bandwidth.ts
        vonage.ts
        plivo.ts
        messagebird.ts
    email
      types.ts
      providerFactory.ts
      providers
        mock.ts
        postmark.ts
        sendgrid.ts
        mailgun.ts
        resend.ts
        ses.ts
        insforgeEmail.ts
  ai
    agent.ts
    prompts.ts
    decisionSchema.ts
    retrieval.ts
    embeddings.ts
    llmProvider.ts
  jobs
    types.ts
    postgresJobQueue.ts
  shared
    schemas.ts
    crypto.ts
    idempotency.ts
    errors.ts
    phone.ts
    email.ts

Core product requirements:

1. Organizations and users
- Use InsForge Auth.
- Users belong to organizations.
- Organization members can view conversations, send replies, manage knowledge, and configure settings.
- Support roles: owner, admin, agent, viewer.

2. Contacts
Create contacts with:
- id
- organization_id
- name
- email
- phone
- metadata
- created_at
- updated_at

Contacts should be matched by normalized email or phone number.

3. Conversations
Create conversations with:
- id
- organization_id
- contact_id
- channel: sms | email
- status: open | pending | resolved | escalated
- assignee_user_id nullable
- subject nullable
- last_message_at
- ai_state: idle | thinking | drafted | auto_replied | needs_human | failed
- created_at
- updated_at

4. Messages
Create messages with:
- id
- organization_id
- conversation_id
- sender_type: customer | human_agent | ai_agent | system
- direction: inbound | outbound | internal
- channel: sms | email
- body
- raw_payload
- provider
- provider_account_id
- external_message_id
- delivery_status
- delivery_error_code
- delivery_error_message
- idempotency_key
- created_at

Add idempotency constraints so duplicate provider webhooks do not create duplicate messages.

5. SMS support
Build SMS as a provider-neutral channel.

Supported providers:
- mock
- Twilio
- Telnyx
- Bandwidth
- Vonage
- Plivo
- MessageBird

Fully implement mock, Twilio, and Telnyx first. Scaffold the others with clear TODOs and matching adapter interfaces.

Create SMS types:

type SmsProvider =
  | "mock"
  | "twilio"
  | "telnyx"
  | "bandwidth"
  | "vonage"
  | "plivo"
  | "messagebird";

type NormalizedInboundSms = {
  provider: SmsProvider;
  providerAccountId: string;
  externalMessageId: string;
  from: string;
  to: string;
  text: string;
  mediaUrls?: string[];
  rawPayload: unknown;
  receivedAt: string;
};

type NormalizedSmsStatus = {
  provider: SmsProvider;
  externalMessageId: string;
  status: "queued" | "sent" | "delivered" | "failed" | "undelivered" | "unknown";
  errorCode?: string;
  errorMessage?: string;
  rawPayload: unknown;
  occurredAt: string;
};

type SendSmsInput = {
  organizationId: string;
  providerAccountId: string;
  from: string;
  to: string;
  text: string;
  mediaUrls?: string[];
  idempotencyKey?: string;
  statusCallbackUrl?: string;
};

type SendSmsResult = {
  provider: SmsProvider;
  externalMessageId: string;
  status: "queued" | "sent" | "accepted" | "failed";
  rawResponse: unknown;
};

interface SmsProviderAdapter {
  provider: SmsProvider;

  sendSms(input: SendSmsInput): Promise<SendSmsResult>;

  parseInboundWebhook(input: {
    headers: Record<string, string>;
    rawBody: string;
    body: unknown;
    query?: Record<string, string>;
  }): Promise<NormalizedInboundSms[]>;

  parseStatusWebhook(input: {
    headers: Record<string, string>;
    rawBody: string;
    body: unknown;
    query?: Record<string, string>;
  }): Promise<NormalizedSmsStatus[]>;

  verifyWebhook(input: {
    headers: Record<string, string>;
    rawBody: string;
    url: string;
  }): Promise<boolean>;
}

SMS inbound flow:
1. Provider sends webhook to InsForge function sms-inbound.
2. Function resolves provider from query or route.
3. Function loads provider adapter.
4. Adapter verifies webhook signature when supported.
5. Adapter normalizes payload into NormalizedInboundSms.
6. Function dedupes by provider + externalMessageId.
7. Match sms_phone_numbers by inbound `to`.
8. Resolve organization and provider account.
9. Find or create contact by `from`.
10. Find or create open SMS conversation.
11. Insert inbound customer message.
12. Update conversation last_message_at and ai_state.
13. Insert audit log.
14. Insert support_jobs row with type process_ai_message.
15. Return 2xx quickly.

SMS outbound flow:
1. Human or AI sends reply through send-reply function.
2. Load conversation and contact.
3. Select outbound SMS number.
4. Prefer replying from the same number that received the inbound message.
5. Load sms_provider_account.
6. Use SmsProviderFactory to send through the correct provider.
7. Store outbound message with provider, provider_account_id, external_message_id, and idempotency_key.
8. Log audit event.
9. Update delivery status later from status webhooks.

6. Email support
Build email as a provider-neutral channel.

Supported providers:
- mock
- Postmark
- SendGrid
- Mailgun
- Resend
- AWS SES
- InsForge Email, only if useful for outbound transactional email

Fully implement mock and one real provider first, preferably Postmark or SendGrid. Scaffold the others.

Create email types:

type EmailProvider =
  | "mock"
  | "postmark"
  | "sendgrid"
  | "mailgun"
  | "resend"
  | "ses"
  | "insforge_email";

type NormalizedInboundEmail = {
  provider: EmailProvider;
  providerAccountId: string;
  externalMessageId: string;
  fromEmail: string;
  fromName?: string;
  toEmail: string;
  subject?: string;
  textBody?: string;
  htmlBody?: string;
  attachments?: Array<{
    filename: string;
    contentType: string;
    sizeBytes?: number;
    storagePath?: string;
    providerUrl?: string;
  }>;
  rawPayload: unknown;
  receivedAt: string;
};

type NormalizedEmailStatus = {
  provider: EmailProvider;
  externalMessageId: string;
  status: "queued" | "sent" | "delivered" | "bounced" | "complained" | "failed" | "unknown";
  errorCode?: string;
  errorMessage?: string;
  rawPayload: unknown;
  occurredAt: string;
};

type SendEmailInput = {
  organizationId: string;
  providerAccountId: string;
  fromEmail: string;
  fromName?: string;
  toEmail: string;
  subject: string;
  textBody?: string;
  htmlBody?: string;
  threadId?: string;
  replyToExternalMessageId?: string;
  idempotencyKey?: string;
};

type SendEmailResult = {
  provider: EmailProvider;
  externalMessageId: string;
  status: "queued" | "sent" | "accepted" | "failed";
  rawResponse: unknown;
};

interface EmailProviderAdapter {
  provider: EmailProvider;

  sendEmail(input: SendEmailInput): Promise<SendEmailResult>;

  parseInboundWebhook(input: {
    headers: Record<string, string>;
    rawBody: string;
    body: unknown;
    query?: Record<string, string>;
  }): Promise<NormalizedInboundEmail[]>;

  parseStatusWebhook(input: {
    headers: Record<string, string>;
    rawBody: string;
    body: unknown;
    query?: Record<string, string>;
  }): Promise<NormalizedEmailStatus[]>;

  verifyWebhook(input: {
    headers: Record<string, string>;
    rawBody: string;
    url: string;
  }): Promise<boolean>;
}

Email inbound flow:
1. Provider sends webhook to email-inbound function.
2. Function resolves provider.
3. Adapter verifies webhook signature.
4. Adapter normalizes payload into NormalizedInboundEmail.
5. Deduplicate by provider + externalMessageId.
6. Match email_addresses by inbound `toEmail`.
7. Resolve organization and provider account.
8. Find or create contact by fromEmail.
9. Find or create open email conversation.
10. Store inbound message.
11. Store attachments in InsForge Storage if needed.
12. Insert audit log.
13. Insert support_jobs row with type process_ai_message.
14. Return 2xx quickly.

7. Knowledge base
Create knowledge documents and chunks.

Knowledge documents:
- id
- organization_id
- title
- source_type: manual | url | file
- body
- storage_path
- status: draft | processing | ready | failed
- created_at
- updated_at

Knowledge chunks:
- id
- organization_id
- document_id
- content
- embedding vector
- metadata
- created_at

Use pgvector for retrieval.

Create a match_knowledge_chunks RPC:
- Input: organization_id, query_embedding, match_count, match_threshold
- Output: chunk id, document id, content, metadata, similarity
- Filter by organization_id
- Order by vector similarity
- Return top matching chunks

Knowledge ingestion flow:
1. User creates or edits article.
2. Insert support_jobs row with type process_knowledge_document.
3. process-knowledge-document function chunks content.
4. Generate embeddings through InsForge AI gateway if available, otherwise through a provider-neutral embedding adapter.
5. Delete old chunks for the document.
6. Insert new chunks.
7. Mark document ready or failed.
8. Log audit event.

8. AI agent
Create a provider-neutral AI agent package.

The AI agent should:
- Load organization AI settings.
- Load conversation and recent message history.
- Retrieve relevant knowledge chunks.
- Apply deterministic escalation rules before calling the LLM.
- Call LLM only when safe.
- Generate strict JSON.
- Validate JSON before acting.
- Store only a short audit-safe reasoning summary.
- Never store chain-of-thought.
- Never invent company policy.
- Escalate when knowledge is missing or confidence is low.
- Keep SMS responses short.
- Keep email responses concise but more complete.

AI settings:
- id
- organization_id
- mode: off | draft_only | auto_reply
- auto_reply_min_confidence
- support_persona
- business_name
- business_description
- escalation_keywords
- model
- embedding_model
- created_at
- updated_at

AI decisions:
- id
- organization_id
- conversation_id
- message_id
- decision_type: auto_reply | draft_reply | ask_clarifying_question | escalate | no_action
- confidence
- reasoning_summary
- draft_response
- sent_message_id
- tags
- requires_human
- created_at

LLM output must be strict JSON:

{
  "decision_type": "auto_reply" | "draft_reply" | "ask_clarifying_question" | "escalate" | "no_action",
  "confidence": 0.0,
  "reasoning_summary": "short audit-safe explanation",
  "response": "customer-facing response or null",
  "tags": ["billing", "shipping", "refund", "technical", "other"],
  "requires_human": true
}

Escalate if:
- customer asks for a human
- customer is angry or abusive
- legal threat
- chargeback
- refund dispute
- billing error
- cancellation request
- account security issue
- medical, legal, or safety issue
- missing knowledge
- low confidence
- repeated failed AI answers
- provider sending failure
- configured escalation keyword appears

AI modes:
- off: do not generate responses
- draft_only: create AI draft for human approval
- auto_reply: auto-send only when confidence is above threshold and requires_human is false

9. Job queue
Use a Postgres-backed support_jobs table for MVP.

Do not assume InsForge Functions are a full background job system. Keep functions short and bounded. Webhooks should enqueue jobs and return quickly.

Create support_jobs:
- id
- organization_id
- type: process_ai_message | process_knowledge_document | send_outbound_message | process_delivery_status | retry_failed_jobs
- status: queued | running | succeeded | failed | dead
- payload
- attempts
- max_attempts
- run_after
- locked_at
- locked_by
- last_error
- created_at
- updated_at

Create an atomic claim_support_jobs RPC using SELECT FOR UPDATE SKIP LOCKED.

Job behavior:
- Jobs should be idempotent.
- Failed jobs should retry with exponential backoff.
- After max_attempts, mark job dead.
- Store last_error.
- Insert audit logs for key failures.

Important queue use cases:
- process_ai_message after inbound SMS/email
- process_knowledge_document after knowledge article changes
- send_outbound_message if provider sending should be retried
- process_delivery_status for provider delivery callbacks
- retry_failed_jobs / dead job handling

For MVP, process jobs through:
- process-jobs InsForge Function
- manual admin/dev trigger button
- scheduled invocation if InsForge supports schedules
- otherwise document how to call it periodically

Design the JobQueue interface so this can later move to Inngest, Trigger.dev, BullMQ, Cloud Tasks, SQS, or Temporal without rewriting product logic.

10. Database tables
Create SQL migrations for:

organizations
- id uuid primary key
- name text not null
- slug text unique
- created_at timestamptz default now()
- updated_at timestamptz default now()

organization_members
- id uuid primary key
- organization_id uuid references organizations(id)
- user_id text not null
- role text check role in ('owner', 'admin', 'agent', 'viewer')
- created_at timestamptz default now()
- unique(organization_id, user_id)

contacts
- id uuid primary key
- organization_id uuid references organizations(id)
- name text
- email text
- phone text
- metadata jsonb default '{}'
- created_at timestamptz default now()
- updated_at timestamptz default now()

conversations
- id uuid primary key
- organization_id uuid references organizations(id)
- contact_id uuid references contacts(id)
- channel text check channel in ('sms', 'email')
- status text check status in ('open', 'pending', 'resolved', 'escalated')
- assignee_user_id text
- subject text
- last_message_at timestamptz
- ai_state text check ai_state in ('idle', 'thinking', 'drafted', 'auto_replied', 'needs_human', 'failed')
- created_at timestamptz default now()
- updated_at timestamptz default now()

messages
- id uuid primary key
- organization_id uuid references organizations(id)
- conversation_id uuid references conversations(id)
- sender_type text check sender_type in ('customer', 'human_agent', 'ai_agent', 'system')
- direction text check direction in ('inbound', 'outbound', 'internal')
- channel text check channel in ('sms', 'email')
- body text
- raw_payload jsonb default '{}'
- provider text
- provider_account_id uuid
- external_message_id text
- delivery_status text
- delivery_error_code text
- delivery_error_message text
- idempotency_key text
- created_at timestamptz default now()

sms_provider_accounts
- id uuid primary key
- organization_id uuid references organizations(id)
- provider text not null
- display_name text not null
- credentials_encrypted text not null
- is_default boolean default false
- is_active boolean default true
- created_at timestamptz default now()
- updated_at timestamptz default now()

sms_phone_numbers
- id uuid primary key
- organization_id uuid references organizations(id)
- provider_account_id uuid references sms_provider_accounts(id)
- phone_number text not null
- label text
- capabilities jsonb default '{}'
- is_default_outbound boolean default false
- is_active boolean default true
- created_at timestamptz default now()
- updated_at timestamptz default now()

sms_delivery_events
- id uuid primary key
- organization_id uuid references organizations(id)
- provider text not null
- provider_account_id uuid references sms_provider_accounts(id)
- external_message_id text not null
- message_id uuid references messages(id)
- status text not null
- error_code text
- error_message text
- raw_payload jsonb default '{}'
- occurred_at timestamptz
- created_at timestamptz default now()

email_provider_accounts
- id uuid primary key
- organization_id uuid references organizations(id)
- provider text not null
- display_name text not null
- credentials_encrypted text not null
- is_default boolean default false
- is_active boolean default true
- created_at timestamptz default now()
- updated_at timestamptz default now()

email_addresses
- id uuid primary key
- organization_id uuid references organizations(id)
- provider_account_id uuid references email_provider_accounts(id)
- email_address text not null
- display_name text
- is_default_outbound boolean default false
- is_active boolean default true
- created_at timestamptz default now()
- updated_at timestamptz default now()

email_delivery_events
- id uuid primary key
- organization_id uuid references organizations(id)
- provider text not null
- provider_account_id uuid references email_provider_accounts(id)
- external_message_id text not null
- message_id uuid references messages(id)
- status text not null
- error_code text
- error_message text
- raw_payload jsonb default '{}'
- occurred_at timestamptz
- created_at timestamptz default now()

ai_settings
- id uuid primary key
- organization_id uuid references organizations(id) unique
- mode text check mode in ('off', 'draft_only', 'auto_reply')
- auto_reply_min_confidence numeric default 0.85
- support_persona text
- business_name text
- business_description text
- escalation_keywords text[]
- model text
- embedding_model text
- created_at timestamptz default now()
- updated_at timestamptz default now()

ai_decisions
- id uuid primary key
- organization_id uuid references organizations(id)
- conversation_id uuid references conversations(id)
- message_id uuid references messages(id)
- decision_type text check decision_type in ('auto_reply', 'draft_reply', 'ask_clarifying_question', 'escalate', 'no_action')
- confidence numeric
- reasoning_summary text
- draft_response text
- sent_message_id uuid references messages(id)
- tags text[]
- requires_human boolean default false
- created_at timestamptz default now()

knowledge_documents
- id uuid primary key
- organization_id uuid references organizations(id)
- title text not null
- source_type text check source_type in ('manual', 'url', 'file')
- body text
- storage_path text
- status text check status in ('draft', 'processing', 'ready', 'failed')
- created_at timestamptz default now()
- updated_at timestamptz default now()

knowledge_chunks
- id uuid primary key
- organization_id uuid references organizations(id)
- document_id uuid references knowledge_documents(id)
- content text not null
- embedding vector
- metadata jsonb default '{}'
- created_at timestamptz default now()

support_jobs
- id uuid primary key
- organization_id uuid references organizations(id)
- type text
- status text
- payload jsonb not null default '{}'
- attempts int default 0
- max_attempts int default 5
- run_after timestamptz default now()
- locked_at timestamptz
- locked_by text
- last_error text
- created_at timestamptz default now()
- updated_at timestamptz default now()

audit_logs
- id uuid primary key
- organization_id uuid references organizations(id)
- actor_type text check actor_type in ('user', 'ai', 'system')
- actor_id text
- action text not null
- target_type text
- target_id text
- metadata jsonb default '{}'
- created_at timestamptz default now()

Add indexes:
- contacts(organization_id, email)
- contacts(organization_id, phone)
- conversations(organization_id, status, last_message_at desc)
- messages(conversation_id, created_at)
- messages(provider, external_message_id)
- messages(organization_id, idempotency_key)
- support_jobs(status, run_after, created_at)
- knowledge_chunks(organization_id, document_id)
- vector index for knowledge_chunks.embedding if supported

Add uniqueness/idempotency:
- unique(provider, external_message_id) where external_message_id is not null
- unique(organization_id, idempotency_key) where idempotency_key is not null
- unique(organization_id, phone_number) on sms_phone_numbers
- unique(organization_id, email_address) on email_addresses

11. RLS and security
Implement RLS so users only access organizations they belong to.

Protect:
- organizations
- organization_members
- contacts
- conversations
- messages
- ai_settings
- ai_decisions
- knowledge_documents
- knowledge_chunks
- provider metadata
- delivery events
- support_jobs
- audit_logs

Credentials:
- Never expose provider credentials to the browser.
- Store encrypted credentials.
- Use InsForge secrets or server-side encryption.
- Settings UI may show masked credential status, display names, phone numbers, email addresses, and webhook URLs, but never raw secrets.

12. InsForge Functions
Create these functions:

sms-inbound
- Handles inbound SMS webhooks.

sms-status
- Handles SMS delivery status webhooks.

email-inbound
- Handles inbound email webhooks.

email-status
- Handles email delivery/bounce/complaint status webhooks.

send-reply
- Sends a human or system reply through the correct provider.
- Works for SMS and email.
- Uses idempotency.

approve-ai-draft
- Approves the latest AI draft and sends it.

regenerate-ai-draft
- Creates a new AI decision/draft for a conversation.

process-ai-job
- Processes one AI job.

process-knowledge-document
- Chunks and embeds one knowledge document.

process-jobs
- Claims and processes a small batch of queued support_jobs.

escalate-conversation
- Sets status to escalated and logs why.

resolve-conversation
- Sets status to resolved.

reopen-conversation
- Reopens resolved/escalated conversation.

test-channel-connection
- Tests configured SMS/email provider credentials.

All functions should:
- Validate input.
- Authenticate when required.
- Authorize organization access when required.
- Use server-side credentials.
- Log audit events.
- Fail safely.
- Avoid duplicate sends.

13. Frontend requirements
Build a usable UI with real backend data.

Routes:
- /login
- /inbox
- /knowledge
- /settings
- /settings/ai
- /settings/sms
- /settings/email
- /analytics

Inbox page:
- Left sidebar conversation list
- Filters: open, pending, escalated, resolved, SMS, email
- Search by contact, email, phone, subject
- Main message thread
- Channel badge
- Status badge
- AI state badge
- Delivery status indicators
- Right contact panel
- AI draft panel
- AI confidence display
- Escalation reason if present
- Composer for manual replies
- Buttons:
  - Send reply
  - Approve AI draft
  - Regenerate draft
  - Escalate
  - Resolve
  - Reopen

Knowledge page:
- List knowledge documents
- Add manual article
- Edit article
- Delete article
- Reprocess document
- Show processing status
- Show chunk count if available

AI settings page:
- Business name
- Business description
- Support persona
- AI mode: off | draft_only | auto_reply
- Auto-reply confidence threshold
- Escalation keywords
- Model
- Embedding model

SMS settings page:
- List SMS provider accounts
- Add/edit provider account
- Add phone number
- Set default outbound number
- Set active/inactive
- Show webhook URLs for each provider

Email settings page:
- List email provider accounts
- Add/edit provider account
- Add support email address
- Set default outbound address
- Set active/inactive
- Show webhook URLs for each provider

Analytics page:
- Total conversations
- Open conversations
- Pending conversations
- Escalated conversations
- Resolved conversations
- AI drafts
- AI auto-replies
- Human replies
- Channel split: SMS vs email
- Escalation rate
- First response time if feasible

Realtime:
Use InsForge Realtime to update:
- New inbound messages
- New outbound messages
- Conversation status changes
- AI draft availability
- Delivery status changes
- Job status changes

14. Audit logs
Create audit logs for:
- inbound message received
- outbound message sent
- AI decision created
- AI auto-reply sent
- AI draft approved
- AI draft regenerated
- conversation escalated
- conversation resolved
- conversation reopened
- settings updated
- provider account created/updated
- knowledge document created/updated/processed
- job failed/dead

15. Local development and seed data
Create seed data:
- One organization
- One test user
- One AI settings row
- One mock SMS provider account
- One mock SMS phone number
- One mock email provider account
- One mock support email address
- A few contacts
- A few conversations
- A few messages
- A few knowledge documents
- A few knowledge chunks if possible

README must include:
- InsForge setup
- How to connect InsForge project
- How to run migrations
- How to seed data
- How to run the Next.js app
- How to configure mock SMS/email
- How to configure Twilio
- How to configure Telnyx
- How to configure Postmark or SendGrid
- How to configure LLM/embedding provider
- How to test inbound SMS webhook locally
- How to test inbound email webhook locally
- How to process jobs
- How to deploy functions
- Known MVP limitations

16. Testing
Add tests for:
- Twilio inbound normalization
- Telnyx inbound normalization
- Mock SMS inbound creates contact/conversation/message
- Mock email inbound creates contact/conversation/message
- Duplicate webhook idempotency
- SMS outbound sends through selected provider
- Email outbound sends through selected provider
- Status webhook updates delivery status
- AI JSON parser validation
- Deterministic escalation rules
- Knowledge retrieval
- Approve AI draft sends outbound message
- support_jobs claim logic does not double-process jobs

17. Lock-in avoidance rules
Follow these rules strictly:
- Keep schema as normal SQL migrations.
- Keep product data in portable Postgres tables.
- Keep InsForge Functions thin.
- Do not put all business logic inside function files.
- Keep AI behind LlmProvider and EmbeddingProvider interfaces.
- Keep SMS behind SmsProviderAdapter.
- Keep email behind EmailProviderAdapter.
- Keep jobs behind JobQueue.
- Keep data access behind repository wrappers.
- Do not scatter raw InsForge SDK calls throughout the entire app.
- Do not use InsForge Email as the only email strategy.
- Do not rely on InsForge Functions as a full durable queue system.
- Design so the backend could later move to Supabase, custom Postgres, or another stack with limited rewrites.

18. Implementation order
Work in this order:

1. Read InsForge docs and confirm current recommended setup.
2. Create repo/folder structure.
3. Connect Next.js app to InsForge.
4. Implement InsForge Auth.
5. Create SQL schema, indexes, RLS, and seed data.
6. Build basic inbox UI from real database data.
7. Build contacts, conversations, and messages repositories.
8. Implement mock SMS provider.
9. Implement mock email provider.
10. Implement sms-inbound and email-inbound functions.
11. Implement provider-neutral send-reply function.
12. Implement SMS provider factory.
13. Implement Twilio adapter.
14. Implement Telnyx adapter.
15. Implement email provider factory.
16. Implement Postmark or SendGrid adapter.
17. Add delivery status webhooks.
18. Add support_jobs table and claim RPC.
19. Add process-jobs function.
20. Add knowledge base CRUD.
21. Add pgvector retrieval RPC.
22. Add process-knowledge-document function.
23. Add AI decision schema and parser.
24. Add escalation rules.
25. Add process-ai-job function.
26. Add AI draft panel.
27. Add approve/regenerate AI draft flow.
28. Add auto-reply mode.
29. Add settings pages.
30. Add analytics page.
31. Add realtime subscriptions.
32. Add tests.
33. Add README and env examples.
34. Run the app locally and verify acceptance criteria.

19. Acceptance criteria
The MVP is complete when:

- I can run the Next.js app locally.
- I can log in with InsForge Auth.
- I can see seeded conversations in the inbox.
- I can create and edit knowledge base articles.
- Knowledge articles can be chunked and embedded.
- I can simulate inbound SMS using the mock provider.
- I can simulate inbound SMS using Twilio or Telnyx if credentials are configured.
- I can simulate inbound email using the mock provider.
- I can simulate inbound email using Postmark or SendGrid if credentials are configured.
- Inbound messages create normalized contacts, conversations, and messages.
- Duplicate webhook events do not create duplicate messages.
- AI processing creates a grounded response from knowledge chunks.
- Draft mode shows AI drafts in the inbox.
- Approving an AI draft sends through the provider-neutral outbound flow.
- Auto-reply mode sends only when confidence is above threshold and no escalation rule triggers.
- Sensitive or low-confidence cases escalate to a human.
- Human manual replies work for SMS and email.
- Delivery status webhooks update messages.
- Realtime updates the inbox.
- Audit logs are created for major actions.
- Provider credentials are never exposed to the browser.
- README explains setup, local testing, provider configuration, and deployment.

Before coding, output:
1. Architecture summary
2. InsForge resources to create
3. SQL schema plan
4. RLS/security plan
5. Function list
6. Frontend route/component plan
7. Job queue plan
8. Provider adapter plan
9. Implementation milestones

Then start implementing step by step.