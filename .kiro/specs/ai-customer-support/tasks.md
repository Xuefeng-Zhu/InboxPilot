# Implementation Plan: InboxPilot AI Customer Support Platform

## Overview

This plan implements InboxPilot, a multi-tenant AI-powered customer support platform built on InsForge. Tasks follow a bottom-up approach: project scaffolding → database schema → core interfaces and repositories → provider adapters → serverless functions → AI/knowledge pipeline → frontend pages → realtime → tests → documentation. Each task references specific requirements and design components. TypeScript is used throughout, with Vitest + fast-check for testing.

## Tasks

- [x] 1. Project scaffolding and InsForge connection
  - [x] 1.1 Create repository folder structure and install dependencies
    - Create `packages/support-core/` with `src/`, `__tests__/`, `tsconfig.json`
    - Create `insforge/functions/` directory for all 14 function entrypoints
    - Create Next.js app structure under `app/` with Tailwind CSS
    - Install dependencies: `insforge-sdk`, `fast-check`, `vitest`, `zod`, `tailwindcss`
    - _Requirements: 25.1, 25.6, 28.1_

  - [x] 1.2 Connect Next.js app to InsForge
    - Create InsForge client utility (`lib/insforge.ts`) with `INSFORGE_BASE_URL` and `ANON_KEY`
    - Create `.env.example` with all required environment variables
    - Configure InsForge auth provider in the Next.js app layout
    - _Requirements: 16.4, 28.2_

- [x] 2. Implement InsForge authentication
  - [x] 2.1 Build auth pages and session management
    - Create `/login` page with email and password form
    - Create `/register` page with email and password form
    - Implement sign-in, sign-up, and sign-out using InsForge Auth SDK
    - Add auth middleware to redirect unauthenticated users to `/login`
    - Display generic error messages on auth failure (no email existence leak)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 17.1, 17.2, 17.3, 17.4_

- [x] 3. Database schema, indexes, RLS, and seed data
  - [x] 3.1 Create SQL migration for all tables
    - Write migration SQL enabling `pgvector` extension
    - Define all 17 tables: organizations, organization_members, contacts, conversations, messages, sms_provider_accounts, sms_phone_numbers, sms_delivery_events, email_provider_accounts, email_addresses, email_delivery_events, ai_settings, ai_decisions, knowledge_documents, knowledge_chunks, support_jobs, audit_logs
    - Define all foreign keys, unique constraints, check constraints, and indexes per design
    - Create HNSW index on `knowledge_chunks.embedding` for vector similarity search
    - Create partial index on `(provider, external_message_id)` for message deduplication
    - Create partial index on `(status, run_after)` for job queue claiming
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 6.1, 6.2, 13.1_

  - [x] 3.2 Create RPC functions
    - Implement `match_knowledge_chunks` RPC for pgvector cosine similarity search
    - Implement `claim_support_jobs` RPC with `SELECT FOR UPDATE SKIP LOCKED`
    - _Requirements: 10.5, 13.2_

  - [x] 3.3 Create Row Level Security policies
    - Enable RLS on all tenant-scoped tables
    - Create policies restricting SELECT, INSERT, UPDATE, DELETE to rows matching the user's organization membership via JWT
    - Ensure credential columns in provider account tables are excluded from client queries
    - Create append-only policy on audit_logs (no UPDATE or DELETE)
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 24.3, 24.4, 22.3_

  - [x] 3.4 Create seed data script
    - Create idempotent seed script with: 1 organization, 1 owner member, 3 contacts, 5 conversations (SMS + email), 10 messages, 2 knowledge documents with chunks/embeddings, sample AI settings
    - Ensure running the script multiple times does not create duplicates
    - _Requirements: 27.1, 27.2_

- [x] 4. Checkpoint — Verify schema and seed data
  - Ensure migrations apply cleanly, RPC functions work, RLS policies are active, and seed data loads without errors. Ask the user if questions arise.

- [x] 5. Core interfaces and types
  - [x] 5.1 Define core TypeScript interfaces and types
    - Create `DatabaseClient` interface with `from()` and `rpc()` methods
    - Create `SmsProviderAdapter` interface with `sendSms`, `parseInboundWebhook`, `parseStatusWebhook`, `verifyWebhook`
    - Create `EmailProviderAdapter` interface with `sendEmail`, `parseInboundWebhook`, `parseStatusWebhook`, `verifyWebhook`
    - Create `ProviderRegistry` class with `registerSmsAdapter`, `registerEmailAdapter`, `getSmsAdapter`, `getEmailAdapter`
    - Create `JobQueue` interface with `enqueue`, `claim`, `complete`, `fail`
    - Create `AiClient` interface with `chatCompletion`, `createEmbedding`
    - Create `RealtimePublisher` interface with `publish`
    - Create `EscalationRule` interface and `EscalationEngine` class
    - Define all shared types: `Contact`, `Conversation`, `Message`, `AiDecision`, `Job`, `KnowledgeDocument`, `KnowledgeChunk`, `AuditLog`, `NormalizedInboundSms`, `NormalizedInboundEmail`, `NormalizedDeliveryStatus`, etc.
    - _Requirements: 7.1, 8.1, 13.7, 25.2, 25.3, 25.4, 25.5, 25.6_

  - [x] 5.2 Implement phone number and email normalization utilities
    - Implement E.164 phone normalization (strip non-digits, add country code, validate length)
    - Implement email normalization (lowercase, trim, basic RFC 5322 validation)
    - _Requirements: 4.1, 4.2_

  - [x] 5.3 Write property tests for normalization
    - **Property 1: Phone number normalization round-trip**
    - **Validates: Requirements 4.1**
    - **Property 2: Email normalization idempotence**
    - **Validates: Requirements 4.2**

- [x] 6. Repository layer
  - [x] 6.1 Implement ContactRepository
    - `findByPhone`, `findByEmail`, `create`, `update` methods
    - All methods accept `DatabaseClient` via constructor injection
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 25.6_

  - [x] 6.2 Implement ConversationRepository
    - `findOpenByContactAndChannel`, `create`, `update`, `listByOrg` methods
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 25.6_

  - [x] 6.3 Implement MessageRepository
    - `findByExternalId`, `create`, `listByConversation` methods
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 25.6_

  - [x] 6.4 Implement remaining repositories
    - `OrganizationRepository`, `MemberRepository`, `AiSettingsRepository`, `AiDecisionRepository`, `JobRepository`, `KnowledgeRepository`, `AuditLogRepository`, `SmsProviderAccountRepository`, `EmailProviderAccountRepository`, `DeliveryEventRepository`
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 9.1, 9.2, 9.3, 11.1, 13.1, 22.1, 22.2, 25.6_

- [x] 7. Build basic inbox UI from real database data
  - [x] 7.1 Create inbox page layout
    - Build `/inbox` page with conversation list panel (left) and message thread panel (right)
    - Fetch conversations from InsForge PostgREST sorted by `last_message_at` descending
    - Display conversation status badges and ai_state indicators
    - _Requirements: 18.1, 18.2_

  - [x] 7.2 Create message thread and reply composer
    - Display messages in chronological order with sender type indicators
    - Build reply composer with text input and send button
    - Show contact details panel alongside the thread
    - _Requirements: 18.2, 18.3_

- [x] 8. Implement mock SMS provider adapter
  - [x] 8.1 Create MockSmsAdapter
    - Implement `SmsProviderAdapter` interface: `sendSms`, `parseInboundWebhook`, `parseStatusWebhook`, `verifyWebhook`
    - Store sent messages in memory for testing
    - Generate deterministic `externalMessageId` values
    - _Requirements: 7.1, 7.2, 25.2_

  - [x] 8.2 Write property tests for SMS webhook normalization
    - **Property 3 (SMS portion): Webhook payload normalization round-trip for mock SMS**
    - **Validates: Requirements 7.2, 29.1, 29.10**

- [x] 9. Implement mock email provider adapter
  - [x] 9.1 Create MockEmailAdapter
    - Implement `EmailProviderAdapter` interface: `sendEmail`, `parseInboundWebhook`, `parseStatusWebhook`, `verifyWebhook`
    - Store sent emails in memory for testing
    - _Requirements: 8.1, 8.2, 25.3_

  - [x] 9.2 Write property tests for email webhook normalization
    - **Property 3 (email portion): Webhook payload normalization round-trip for mock email**
    - **Validates: Requirements 8.2, 29.2, 29.10**

- [x] 10. Implement inbound message processing
  - [x] 10.1 Implement InboundMessageService
    - Create `processInboundSms` and `processInboundEmail` methods
    - Normalize contact identifier, find-or-create contact, find-or-create conversation, insert message, enqueue `process_ai_message` job
    - Check for duplicate messages by `(provider, external_message_id)` before inserting
    - Record audit log entries for message received
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 6.3, 7.4, 8.4, 22.1_

  - [x] 10.2 Create sms-inbound function entrypoint
    - Verify webhook signature via adapter
    - Parse and normalize inbound payload
    - Delegate to `InboundMessageService.processInboundSms`
    - Publish `new_message` realtime event
    - Return 200 OK
    - _Requirements: 7.4, 16.1, 16.2, 16.3, 23.1, 23.3_

  - [x] 10.3 Create email-inbound function entrypoint
    - Verify webhook signature via adapter
    - Parse and normalize inbound payload
    - Delegate to `InboundMessageService.processInboundEmail`
    - Publish `new_message` realtime event
    - Return 200 OK
    - _Requirements: 8.4, 16.1, 16.2, 16.3, 23.2, 23.3_

  - [x] 10.4 Write property test for message deduplication
    - **Property 7: Message deduplication idempotence**
    - **Validates: Requirements 6.2, 6.3, 29.3**

- [x] 11. Implement provider-neutral send-reply function
  - [x] 11.1 Implement OutboundMessageService
    - Load conversation and determine channel (SMS or email)
    - Select outbound phone number or email address from provider account
    - Send via configured adapter from `ProviderRegistry`
    - Store outbound message with provider, provider_account_id, external_message_id
    - Record audit log entry for message sent
    - _Requirements: 7.5, 8.5, 6.4, 22.1_

  - [x] 11.2 Create send-reply function entrypoint
    - Verify JWT authentication
    - Delegate to `OutboundMessageService.sendReply`
    - Publish `new_message` realtime event
    - _Requirements: 16.1, 16.2, 16.3, 16.5_

- [x] 12. Checkpoint — Verify inbound/outbound message flow
  - Ensure inbound SMS and email processing works end-to-end with mock adapters, replies send correctly, and deduplication works. Ask the user if questions arise.

- [x] 13. Implement real SMS provider adapters
  - [x] 13.1 Implement TwilioSmsAdapter
    - Implement full `SmsProviderAdapter` interface for Twilio
    - Implement webhook signature verification using Twilio signing secret
    - Parse Twilio-specific inbound and status webhook payloads
    - _Requirements: 7.1, 7.2, 23.1, 23.4, 24.1_

  - [x] 13.2 Implement TelnyxSmsAdapter
    - Implement full `SmsProviderAdapter` interface for Telnyx
    - Implement webhook signature verification
    - Parse Telnyx-specific inbound and status webhook payloads
    - _Requirements: 7.1, 7.2, 23.1, 23.4, 24.1_

  - [x] 13.3 Create SMS provider stub adapters
    - Create interface-compliant stubs for Bandwidth, Vonage, Plivo, MessageBird
    - Each stub throws "not implemented" on method calls
    - _Requirements: 7.3_

  - [x] 13.4 Write property tests for SMS webhook normalization across providers
    - **Property 3 (full SMS): Webhook payload normalization round-trip for mock, Twilio, and Telnyx**
    - **Validates: Requirements 7.2, 29.1, 29.10**

- [x] 14. Implement real email provider adapter
  - [x] 14.1 Implement PostmarkEmailAdapter
    - Implement full `EmailProviderAdapter` interface for Postmark
    - Implement webhook signature verification
    - Parse Postmark-specific inbound and status webhook payloads
    - _Requirements: 8.1, 8.2, 23.2, 23.4, 24.1_

  - [x] 14.2 Create email provider stub adapters
    - Create interface-compliant stubs for Mailgun, Resend, AWS SES, InsForge Email
    - Each stub throws "not implemented" on method calls
    - _Requirements: 8.3_

  - [x] 14.3 Write property tests for email webhook normalization across providers
    - **Property 3 (full email): Webhook payload normalization round-trip for mock and Postmark**
    - **Validates: Requirements 8.2, 29.2, 29.10**

- [x] 15. Add delivery status webhooks
  - [x] 15.1 Create sms-status and email-status function entrypoints
    - Verify webhook signature
    - Parse delivery status payload via adapter
    - Match message by `external_message_id`
    - Insert delivery event record and update message `delivery_status`
    - _Requirements: 7.6, 8.6, 16.1, 16.2, 16.3, 23.1, 23.2_

- [x] 16. Implement job queue
  - [x] 16.1 Implement PostgresJobQueue
    - Implement `JobQueue` interface: `enqueue`, `claim`, `complete`, `fail`
    - Use `claim_support_jobs` RPC for atomic claiming
    - Implement exponential backoff: `run_after = now() + 2^attempts seconds`
    - Implement dead-lettering: set status to "dead" when `attempts >= max_attempts`
    - Implement idempotent enqueue: check for existing pending/claimed job with same type and key payload fields
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8_

  - [x] 16.2 Create process-jobs function entrypoint
    - Claim pending jobs via `claim_support_jobs`
    - Route each job to the appropriate handler by `job_type`
    - Handle completion and failure with proper status updates
    - _Requirements: 16.1, 16.2, 16.3_

  - [x] 16.3 Write property tests for job queue
    - **Property 8: Job queue exponential backoff and dead-lettering**
    - **Validates: Requirements 13.4, 13.5, 29.8**
    - **Property 9: Job enqueue idempotency**
    - **Validates: Requirements 13.8**
    - **Property 10: Job claim respects limit and pending status**
    - **Validates: Requirements 13.2**

- [x] 17. Checkpoint — Verify provider adapters and job queue
  - Ensure all SMS/email adapters pass webhook normalization, job queue claims/retries/dead-letters correctly. Ask the user if questions arise.

- [x] 18. Knowledge base CRUD and ingestion
  - [x] 18.1 Implement knowledge base CRUD
    - Build `KnowledgeRepository` methods: `createDocument`, `updateDocument`, `deleteDocumentWithChunks`, `insertChunks`, `deleteChunksByDocument`, `matchChunks`
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [x] 18.2 Implement KnowledgeIngestionService
    - Set document status to "processing"
    - Split document body into chunks
    - Generate embedding for each chunk via `AiClient.createEmbedding`
    - Store chunks with embeddings
    - Set document status to "ready" on success, "failed" on error
    - Clean up partial chunks on failure
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [x] 18.3 Create process-knowledge-document function entrypoint
    - Delegate to `KnowledgeIngestionService.processDocument`
    - Publish `knowledge_document_updated` realtime event on status change
    - _Requirements: 16.1, 16.2, 16.3_

  - [x] 18.4 Write property tests for knowledge base
    - **Property 16: Knowledge chunk similarity ordering**
    - **Validates: Requirements 10.5**
    - **Property 17: Document chunking coverage**
    - **Validates: Requirements 10.1**

- [x] 19. AI agent and escalation engine
  - [x] 19.1 Implement EscalationEngine with all built-in rules
    - Implement `HumanRequestRule`, `ProfanityAngerRule`, `SensitiveTopicRule`, `SafetyConcernRule`, `MissingKnowledgeRule`, `LowConfidenceRule`, `RepeatedFailureRule`, `KeywordRule`
    - Register all rules in the engine
    - Engine evaluates rules in order and returns first match or null
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8_

  - [x] 19.2 Implement AI_Decision schema and parser
    - Define Zod schema for AI_Decision JSON: `decision_type`, `confidence`, `reasoning_summary`, `response_text`, `tags`, `requires_human`
    - Implement strict parse function that returns error on invalid JSON or schema mismatch
    - _Requirements: 11.4, 11.5_

  - [x] 19.3 Write property tests for AI_Decision parsing
    - **Property 4: AI_Decision JSON round-trip**
    - **Validates: Requirements 11.4, 29.5, 29.9**
    - **Property 5: Invalid JSON always produces failure state**
    - **Validates: Requirements 11.5**

  - [x] 19.4 Implement AiAgentService
    - Load AI settings, conversation history (up to context window), and matching knowledge chunks
    - Evaluate escalation engine BEFORE any LLM call
    - If escalation triggers: skip LLM, set ai_state to "needs_human", status to "escalated", record AI_Decision with type "escalate"
    - If no escalation: call LLM via `AiClient`, parse response as AI_Decision
    - Handle AI mode gating: "off" skips processing, "draft_only" stores draft, "auto_reply" sends if confidence ≥ threshold and requires_human is false
    - Record audit log entries for AI decisions
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 22.1_

  - [x] 19.5 Write property tests for escalation engine
    - **Property 6: Escalation engine triggers on matching content**
    - **Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8**

  - [x] 19.6 Write property tests for auto-reply threshold gating
    - **Property 11: Auto-reply threshold gating**
    - **Validates: Requirements 11.8**

  - [x] 19.5b Create process-ai-job function entrypoint
    - Delegate to `AiAgentService.processMessage`
    - Publish `conversation_updated` realtime event
    - _Requirements: 16.1, 16.2, 16.3_

- [x] 20. Checkpoint — Verify AI pipeline
  - Ensure escalation rules fire correctly, AI decisions parse and validate, auto-reply gating works, and knowledge retrieval returns ranked results. Ask the user if questions arise.

- [x] 21. Conversation management functions
  - [x] 21.1 Create escalate-conversation, resolve-conversation, reopen-conversation function entrypoints
    - Verify JWT authentication
    - Implement state transitions: resolve sets status "resolved" and ai_state "idle"; reopen sets status "open"; escalate sets status "escalated" and ai_state "needs_human"
    - Record audit log entries for each action
    - Publish `conversation_updated` realtime event
    - _Requirements: 5.5, 5.6, 5.7, 16.1, 16.2, 16.3, 22.1_

  - [x] 21.2 Write property test for conversation state machine
    - **Property 12: Conversation state machine invariant**
    - **Validates: Requirements 5.3, 5.4**

- [x] 22. AI draft panel and approve/regenerate flow
  - [x] 22.1 Build AI draft panel in inbox UI
    - Display AI draft with confidence score, reasoning summary, and response text when ai_state is "drafted"
    - Add "Approve" and "Regenerate" buttons
    - Show escalation reason when ai_state is "needs_human"
    - _Requirements: 18.4, 18.5, 18.6_

  - [x] 22.2 Create approve-ai-draft and regenerate-ai-draft function entrypoints
    - Verify JWT authentication
    - Approve: send the drafted response via `OutboundMessageService`, update ai_state
    - Regenerate: enqueue new `process_ai_message` job, set ai_state to "thinking"
    - Record audit log entries
    - Publish realtime events
    - _Requirements: 16.1, 16.2, 16.3, 22.1_

- [x] 23. Organization management and RBAC
  - [x] 23.1 Implement organization and member management
    - Create organization creation flow (assigns creator as owner)
    - Implement member invite, role change, and removal
    - Enforce single-owner invariant
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 23.2 Implement RBAC permission checks
    - Define permission matrix: owner (full), admin (all except owner transfer/org deletion), agent (view/reply conversations, view KB, view settings), viewer (read-only conversations and KB)
    - Apply permission checks in function entrypoints and frontend
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 23.3 Write property tests for RBAC
    - **Property 13: Organization owner invariant**
    - **Validates: Requirements 2.2**
    - **Property 14: RBAC permission enforcement**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4**

- [x] 24. Frontend — Settings pages
  - [x] 24.1 Build AI settings page
    - Create `/settings/ai` page with controls for AI mode, confidence threshold, context window size, escalation keywords, system prompt, model selection
    - Save changes via InsForge PostgREST and record audit log
    - _Requirements: 20.1, 20.4_

  - [x] 24.2 Build SMS settings page
    - Create `/settings/sms` page showing SMS provider accounts and phone numbers
    - Add controls to add, edit, remove provider accounts
    - Add "Test Connection" button invoking `test-channel-connection`
    - _Requirements: 20.2, 20.5_

  - [x] 24.3 Build email settings page
    - Create `/settings/email` page showing email provider accounts and addresses
    - Add controls to add, edit, remove provider accounts
    - Add "Test Connection" button invoking `test-channel-connection`
    - _Requirements: 20.3, 20.5_

  - [x] 24.4 Create test-channel-connection function entrypoint
    - Verify JWT authentication
    - Test the configured provider connection and return success/failure
    - _Requirements: 16.1, 20.5_

- [x] 25. Frontend — Knowledge management page
  - [x] 25.1 Build knowledge management page
    - Create `/knowledge` page listing all documents with title, source_type, status, timestamps
    - Add "Add Document" form with title, source_type, and body fields
    - Implement document deletion with confirmation dialog
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5_

- [x] 26. Frontend — Analytics dashboard
  - [x] 26.1 Build analytics page
    - Create `/analytics` page with summary metrics: total conversations, open, resolved, escalated, average response time, AI auto-reply rate
    - Add configurable date range filter
    - Display metrics using summary cards and/or charts
    - _Requirements: 21.1, 21.2, 21.3_

- [x] 27. Realtime subscriptions
  - [x] 27.1 Implement realtime event publishing in all function entrypoints
    - Publish `new_message` on message insert (inbound and outbound)
    - Publish `conversation_updated` on status or ai_state change
    - Publish `knowledge_document_updated` on document status change
    - Use channel naming: `org:{organizationId}`
    - _Requirements: 26.1, 26.2, 26.3_

  - [x] 27.2 Implement frontend realtime subscriptions
    - Subscribe to organization channel on page load
    - Update inbox conversation list and message thread on `new_message`
    - Update conversation status/ai_state on `conversation_updated`
    - Update knowledge document status on `knowledge_document_updated`
    - _Requirements: 18.7, 19.4, 26.4_

- [x] 28. Checkpoint — Verify full frontend and realtime
  - Ensure all pages render correctly, settings save, analytics display, and realtime events update the UI without page refresh. Ask the user if questions arise.

- [x] 29. Audit logging integration
  - [x] 29.1 Wire audit logging across all services and functions
    - Ensure all 13 auditable actions are logged: message sent, message received, AI_Decision produced, conversation escalated/resolved/reopened, settings changed, member added/removed/role changed, knowledge document created/deleted, provider account modified
    - Verify audit_logs table is append-only (no UPDATE/DELETE)
    - _Requirements: 22.1, 22.2, 22.3_

  - [x] 29.2 Write property test for audit log immutability
    - **Property 15: Audit log immutability**
    - **Validates: Requirements 22.3**

- [x] 30. Accessibility compliance
  - [x] 30.1 Add accessibility attributes across all frontend pages
    - Add semantic HTML elements and ARIA attributes to all interactive elements
    - Ensure keyboard navigation for login, inbox browsing, message composition, and settings
    - Verify form labels, button labels, and focus management
    - _Requirements: 30.1, 30.2, 30.3_

- [x] 31. Remaining tests
  - [x] 31.1 Write unit tests for core services
    - Contact service: find-or-create with new vs existing, phone vs email matching
    - Conversation service: create new, append to existing, resolve/reopen/escalate state transitions
    - Message service: outbound message creation with provider fields
    - AI agent service: AI mode gating (off/draft_only/auto_reply), escalation before LLM, LLM call with mock
    - Knowledge ingestion: status transitions (pending → processing → ready/failed), chunk cleanup on failure
    - Escalation engine: individual rule tests with specific trigger phrases
    - _Requirements: 29.1, 29.2, 29.3, 29.4, 29.5, 29.6, 29.7, 29.8_

  - [x] 31.2 Write integration tests
    - Inbound SMS/email flow end-to-end with mock adapters
    - Outbound message flow with mock adapter
    - RLS policy test: two-org isolation verification
    - Realtime event publishing verification
    - Seed script idempotency verification
    - _Requirements: 29.1, 29.2, 29.3, 29.4_

- [x] 32. Documentation
  - [x] 32.1 Create README.md and environment examples
    - Write README with: project overview, prerequisites, environment setup, database migration instructions, seed data instructions, function deployment instructions, frontend dev server instructions, architecture overview
    - Document all required environment variables in `.env.example`
    - _Requirements: 28.1, 28.2_

- [x] 33. Final checkpoint — Full verification
  - Ensure all tests pass, all pages are functional, realtime works, and the application runs locally end-to-end. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at key milestones
- Property tests validate universal correctness properties from the design document (17 properties across 13 test files)
- Unit tests validate specific examples and edge cases
- The implementation follows the layered architecture: Function Entrypoints → Services → Repositories → Adapters
- All business logic lives in `packages/support-core/` and never imports InsForge SDK directly
