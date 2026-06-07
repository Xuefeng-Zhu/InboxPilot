# Requirements Document

## Introduction

InboxPilot is an AI-powered customer support platform that handles inbound and outbound communication over SMS and email channels. The platform uses AI to draft responses, auto-reply to common inquiries, and escalate complex issues to human agents. It is built on InsForge as the backend-as-a-service layer but keeps all business logic portable behind provider-neutral interfaces and repository abstractions, enabling future migration away from InsForge. The MVP targets multi-tenant organizations with role-based access, a knowledge base for AI retrieval-augmented generation, a Postgres-backed job queue, and a Next.js frontend with realtime updates.

> Related documents: `../../docs/COMPETITIVE.md` (competitive landscape, "why InboxPilot, not X" — the 8 escalation rules in Req 12 are "safer than Fin" specifically because of the Fin behaviors named there) · `../../docs/PRICING.md` (3-tier pricing hypothesis; Req 2, Req 11, Req 12 map to the code-checkable boundaries) · `../../docs/LAUNCH_CHECKLIST.md` (go/no-go gating document) · `docs/design.md` (full design doc) · `tasks.md` (implementation task list)

## Glossary

- **Platform**: The InboxPilot customer support system as a whole
- **Auth_Service**: The InsForge JWT authentication module used for user sign-up, sign-in, and session management
- **Organization**: A tenant entity that owns contacts, conversations, messages, knowledge, and settings
- **Member**: A user who belongs to an Organization with an assigned role (owner, admin, agent, or viewer)
- **Contact**: An external person (customer) identified by email or phone who communicates with an Organization
- **Conversation**: A threaded exchange between a Contact and an Organization over a single channel (SMS or email)
- **Message**: A single inbound or outbound communication unit within a Conversation
- **SMS_Gateway**: The provider-neutral adapter layer that sends and receives SMS messages through pluggable providers (mock, Twilio, Telnyx, Bandwidth, Vonage, Plivo, MessageBird)
- **Email_Gateway**: The provider-neutral adapter layer that sends and receives email messages through pluggable providers (mock, Postmark, SendGrid, Mailgun, Resend, AWS SES, InsForge Email)
- **AI_Agent**: The portable AI module that analyzes conversations, retrieves knowledge, applies escalation rules, and produces structured JSON decisions
- **Knowledge_Base**: The collection of documents, chunks, and vector embeddings used for semantic retrieval by the AI_Agent
- **Job_Queue**: The Postgres-backed asynchronous task processing system behind a portable JobQueue interface
- **Ingestion_Pipeline**: The process that splits Knowledge_Base documents into chunks, generates embeddings, and stores them
- **Escalation_Engine**: The deterministic rule set evaluated before any LLM call to decide whether a Conversation requires human attention
- **RLS_Policy**: Row Level Security policies in PostgreSQL that restrict data access to the owning Organization
- **Audit_Log**: A record of significant actions performed within the Platform for traceability
- **Realtime_Service**: The InsForge Socket.IO WebSocket pub/sub layer that pushes live updates to the Frontend
- **Frontend**: The Next.js + React + TypeScript + Tailwind web application
- **Repository**: A data-access abstraction layer that wraps database queries so business logic does not depend on InsForge SDK patterns directly
- **Function_Entrypoint**: A thin InsForge serverless function (Deno-based) that delegates to portable service logic
- **Provider_Account**: A configuration record storing credentials and settings for an SMS or email provider within an Organization
- **Phone_Number**: An SMS-capable phone number associated with a Provider_Account and Organization
- **Email_Address**: A sending/receiving email address associated with an email Provider_Account and Organization
- **AI_Decision**: A structured JSON record produced by the AI_Agent containing decision_type, confidence, reasoning_summary, response text, tags, and a requires_human flag
- **Delivery_Event**: A status update record tracking the delivery lifecycle of an outbound Message (queued, sent, delivered, failed, bounced)

## Requirements

### Requirement 1: User Authentication

**User Story:** As a user, I want to sign up and sign in with email and password, so that I can securely access the Platform.

#### Acceptance Criteria

1. WHEN a user submits valid email and password credentials, THE Auth_Service SHALL create a new account and return a JWT session token.
2. WHEN a user submits valid existing credentials, THE Auth_Service SHALL authenticate the user and return a JWT session token.
3. WHEN a user submits invalid credentials, THE Auth_Service SHALL reject the request and return an authentication error without revealing whether the email exists.
4. WHEN a user signs out, THE Auth_Service SHALL invalidate the current session token.
5. THE Auth_Service SHALL enforce email verification before granting access to Organization data.

---

### Requirement 2: Organization Management

**User Story:** As an owner, I want to create and manage an organization, so that my team can collaborate on customer support.

#### Acceptance Criteria

1. WHEN a verified user creates an Organization, THE Platform SHALL create the Organization record and assign the creating user as the owner Member.
2. THE Platform SHALL enforce that each Organization has exactly one owner Member at all times.
3. WHEN an owner or admin invites a user to an Organization, THE Platform SHALL create a Member record with the specified role (admin, agent, or viewer).
4. WHEN an owner changes a Member role, THE Platform SHALL update the role and apply the new permissions immediately.
5. WHEN an owner removes a Member, THE Platform SHALL revoke that Member's access to all Organization data.

---

### Requirement 3: Role-Based Access Control

**User Story:** As an organization owner, I want to assign roles to members, so that each person has appropriate permissions.

#### Acceptance Criteria

1. WHILE a Member has the owner role, THE Platform SHALL grant full access to all Organization resources including member management, settings, and billing.
2. WHILE a Member has the admin role, THE Platform SHALL grant access to all Organization resources except owner transfer and Organization deletion.
3. WHILE a Member has the agent role, THE Platform SHALL grant access to view and reply to Conversations, view the Knowledge_Base, and view Organization settings.
4. WHILE a Member has the viewer role, THE Platform SHALL grant read-only access to Conversations and the Knowledge_Base.
5. THE RLS_Policy SHALL restrict every database query to return only rows belonging to the requesting Member's Organization.

---

### Requirement 4: Contact Management

**User Story:** As an agent, I want contacts to be automatically created and matched, so that conversations are linked to the correct customer.

#### Acceptance Criteria

1. WHEN an inbound message arrives with a phone number, THE Platform SHALL normalize the phone number to E.164 format and match it against existing Contacts in the Organization.
2. WHEN an inbound message arrives with an email address, THE Platform SHALL normalize the email to lowercase and match it against existing Contacts in the Organization.
3. WHEN no matching Contact exists for an inbound message, THE Platform SHALL create a new Contact record with the normalized identifier and associate the message with the new Contact.
4. WHEN a matching Contact exists, THE Platform SHALL associate the inbound message with the existing Contact.
5. THE Platform SHALL store Contact records with id, organization_id, name, email, phone, metadata (JSONB), created_at, and updated_at fields.

---

### Requirement 5: Conversation Lifecycle

**User Story:** As an agent, I want conversations to be automatically created and tracked, so that I can manage customer interactions efficiently.

#### Acceptance Criteria

1. WHEN an inbound message arrives and no open Conversation exists for the Contact on the same channel, THE Platform SHALL create a new Conversation with status "open" and ai_state "idle".
2. WHEN an inbound message arrives and an open Conversation exists for the Contact on the same channel, THE Platform SHALL append the message to the existing Conversation and update last_message_at.
3. THE Platform SHALL track Conversation status using exactly one of: open, pending, resolved, or escalated.
4. THE Platform SHALL track Conversation ai_state using exactly one of: idle, thinking, drafted, auto_replied, needs_human, or failed.
5. WHEN an agent resolves a Conversation, THE Platform SHALL set the status to "resolved" and the ai_state to "idle".
6. WHEN an agent reopens a resolved Conversation, THE Platform SHALL set the status to "open".
7. WHEN the Escalation_Engine triggers, THE Platform SHALL set the Conversation status to "escalated" and ai_state to "needs_human".

---

### Requirement 6: Message Model

**User Story:** As a developer, I want a complete message model, so that all communication data is captured and traceable.

#### Acceptance Criteria

1. THE Platform SHALL store each Message with: id, conversation_id, sender_type (contact, user, ai, system), direction (inbound, outbound), channel (sms, email), body, raw_payload (JSONB), provider, provider_account_id, external_message_id, delivery_status, created_at, and updated_at.
2. THE Platform SHALL enforce a unique constraint on (provider, external_message_id) to prevent duplicate webhook messages.
3. WHEN a duplicate inbound webhook is received with the same provider and external_message_id, THE Platform SHALL discard the duplicate and return a success response to the webhook caller.
4. WHEN an outbound Message is sent, THE Platform SHALL record the provider, provider_account_id, and external_message_id returned by the provider.

---

### Requirement 7: SMS Support — Provider-Neutral Architecture

**User Story:** As a developer, I want SMS functionality behind a provider-neutral adapter, so that the Platform can switch SMS providers without changing business logic.

#### Acceptance Criteria

1. THE SMS_Gateway SHALL implement the SmsProviderAdapter interface with four methods: sendSms, parseInboundWebhook, parseStatusWebhook, and verifyWebhook.
2. THE SMS_Gateway SHALL provide fully functional adapter implementations for mock, Twilio, and Telnyx providers.
3. THE SMS_Gateway SHALL provide scaffold adapter implementations (interface-compliant stubs) for Bandwidth, Vonage, Plivo, and MessageBird providers.
4. WHEN an inbound SMS webhook is received, THE Function_Entrypoint SHALL delegate to the SMS_Gateway to normalize the payload, deduplicate by external_message_id, match the phone number to a Contact, find or create a Conversation, insert the Message, and enqueue a process_ai_message job.
5. WHEN an agent sends an SMS reply, THE Platform SHALL load the Conversation, select the outbound Phone_Number, send via the configured SMS_Gateway adapter, and store the outbound Message with delivery tracking.
6. WHEN a delivery status webhook is received, THE SMS_Gateway SHALL parse the status, match the Message by external_message_id, and insert a Delivery_Event record.

---

### Requirement 8: Email Support — Provider-Neutral Architecture

**User Story:** As a developer, I want email functionality behind a provider-neutral adapter, so that the Platform can switch email providers without changing business logic.

#### Acceptance Criteria

1. THE Email_Gateway SHALL implement the EmailProviderAdapter interface with four methods: sendEmail, parseInboundWebhook, parseStatusWebhook, and verifyWebhook.
2. THE Email_Gateway SHALL provide fully functional adapter implementations for mock and one real provider (Postmark or SendGrid).
3. THE Email_Gateway SHALL provide scaffold adapter implementations (interface-compliant stubs) for the remaining providers: Mailgun, Resend, AWS SES, and InsForge Email.
4. WHEN an inbound email webhook is received, THE Function_Entrypoint SHALL delegate to the Email_Gateway to normalize the payload, deduplicate by external_message_id, match the email address to a Contact, find or create a Conversation, insert the Message, and enqueue a process_ai_message job.
5. WHEN an agent sends an email reply, THE Platform SHALL load the Conversation, select the outbound Email_Address, send via the configured Email_Gateway adapter, and store the outbound Message with delivery tracking.
6. WHEN a delivery status webhook is received, THE Email_Gateway SHALL parse the status, match the Message by external_message_id, and insert a Delivery_Event record.

---

### Requirement 9: Knowledge Base Document Management

**User Story:** As an admin, I want to upload and manage knowledge documents, so that the AI_Agent can use them to answer customer questions.

#### Acceptance Criteria

1. WHEN an admin uploads a knowledge document, THE Platform SHALL create a Knowledge_Base document record with title, source_type, body, and status set to "pending".
2. THE Platform SHALL store Knowledge_Base documents with id, organization_id, title, source_type, body, status (pending, processing, ready, failed), created_at, and updated_at fields.
3. WHEN an admin deletes a knowledge document, THE Platform SHALL delete the document record and all associated chunks and embeddings.
4. WHEN an admin updates a knowledge document body, THE Platform SHALL set the document status to "pending" and enqueue a new process_knowledge_document job.

---

### Requirement 10: Knowledge Base Ingestion Pipeline

**User Story:** As a developer, I want documents to be automatically chunked and embedded, so that the AI_Agent can perform semantic search.

#### Acceptance Criteria

1. WHEN a process_knowledge_document job executes, THE Ingestion_Pipeline SHALL set the document status to "processing", split the document body into chunks, generate an embedding vector for each chunk using the AI gateway, and store each chunk with its embedding.
2. THE Ingestion_Pipeline SHALL store each chunk with: id, document_id, organization_id, content, embedding (vector), metadata (JSONB), and created_at.
3. IF the Ingestion_Pipeline fails during processing, THEN THE Platform SHALL set the document status to "failed" and record the error in the job record.
4. WHEN the Ingestion_Pipeline completes successfully, THE Platform SHALL set the document status to "ready".
5. THE Platform SHALL provide a match_knowledge_chunks RPC function that accepts a query embedding vector and organization_id, and returns the top matching chunks ranked by cosine similarity using pgvector.

---

### Requirement 11: AI Agent Decision Engine

**User Story:** As an organization, I want an AI agent that drafts responses and auto-replies, so that customers receive fast and accurate support.

#### Acceptance Criteria

1. WHEN a process_ai_message job executes, THE AI_Agent SHALL load the Organization AI settings, the Conversation history (up to the configured context window), and the top matching Knowledge_Base chunks for the latest inbound message.
2. THE AI_Agent SHALL evaluate the Escalation_Engine rules BEFORE making any LLM API call.
3. WHEN the Escalation_Engine determines escalation is required, THE AI_Agent SHALL skip the LLM call, set the Conversation ai_state to "needs_human", set the Conversation status to "escalated", and record an AI_Decision with decision_type "escalate".
4. WHEN the Escalation_Engine does not trigger, THE AI_Agent SHALL call the LLM via the AI gateway and produce a structured JSON AI_Decision containing: decision_type (respond, escalate, clarify), confidence (0.0 to 1.0), reasoning_summary, response text, tags (array), and requires_human (boolean).
5. IF the LLM returns a response that does not conform to the required JSON schema, THEN THE AI_Agent SHALL set the Conversation ai_state to "failed" and record the parsing error.
6. WHILE the Organization AI mode is set to "off", THE AI_Agent SHALL skip all AI processing for inbound messages in that Organization.
7. WHILE the Organization AI mode is set to "draft_only", THE AI_Agent SHALL produce an AI_Decision and set the Conversation ai_state to "drafted" without sending the response to the Contact.
8. WHILE the Organization AI mode is set to "auto_reply", THE AI_Agent SHALL produce an AI_Decision and, when confidence meets the configured threshold and requires_human is false, automatically send the response to the Contact and set ai_state to "auto_replied".

---

### Requirement 12: Escalation Rules

**User Story:** As an organization, I want deterministic escalation rules, so that sensitive conversations are routed to human agents before AI responds.

#### Acceptance Criteria

1. WHEN the latest inbound message contains a request to speak with a human, THE Escalation_Engine SHALL trigger escalation.
2. WHEN the latest inbound message expresses anger or profanity above the configured threshold, THE Escalation_Engine SHALL trigger escalation.
3. WHEN the latest inbound message mentions legal threats, chargebacks, refunds, billing errors, or cancellation requests, THE Escalation_Engine SHALL trigger escalation.
4. WHEN the latest inbound message involves security concerns, medical issues, legal issues, or safety issues, THE Escalation_Engine SHALL trigger escalation.
5. WHEN the Knowledge_Base returns no relevant chunks above the configured similarity threshold, THE Escalation_Engine SHALL trigger escalation with reason "missing_knowledge".
6. WHEN the AI_Decision confidence is below the configured minimum threshold, THE Escalation_Engine SHALL trigger escalation with reason "low_confidence".
7. WHEN the Conversation has accumulated the configured maximum number of consecutive AI failures, THE Escalation_Engine SHALL trigger escalation with reason "repeated_failures".
8. WHEN the latest inbound message contains any keyword from the Organization's configured escalation keyword list, THE Escalation_Engine SHALL trigger escalation.

---

### Requirement 13: Job Queue

**User Story:** As a developer, I want a reliable Postgres-backed job queue behind a portable interface, so that async tasks are processed reliably and the queue implementation can be swapped later.

#### Acceptance Criteria

1. THE Job_Queue SHALL store jobs in a support_jobs table with: id, organization_id, job_type, payload (JSONB), status (pending, claimed, completed, failed, dead), attempts, max_attempts, last_error, run_after, created_at, updated_at, and completed_at.
2. THE Job_Queue SHALL provide a claim_support_jobs RPC function that atomically claims up to N pending jobs using SELECT FOR UPDATE SKIP LOCKED, sets their status to "claimed", and returns the claimed jobs.
3. WHEN a job completes successfully, THE Job_Queue SHALL set the job status to "completed" and record completed_at.
4. WHEN a job fails, THE Job_Queue SHALL increment the attempts count, record the error in last_error, and set run_after to a time calculated using exponential backoff.
5. WHEN a job has failed and attempts equals max_attempts, THE Job_Queue SHALL set the job status to "dead".
6. THE Job_Queue SHALL support these job types: process_ai_message, process_knowledge_document, send_outbound_message, process_delivery_status, and retry_failed_jobs.
7. THE Job_Queue SHALL implement a portable JobQueue interface so the underlying implementation can be replaced with Inngest, Trigger.dev, BullMQ, SQS, or Temporal without changing calling code.
8. THE Job_Queue SHALL guarantee idempotent job execution by checking for duplicate job payloads before enqueuing.

---

### Requirement 14: Database Schema

**User Story:** As a developer, I want a well-structured relational schema, so that all Platform data is stored consistently and efficiently.

#### Acceptance Criteria

1. THE Platform SHALL define the database schema using InsForge SQL migrations posted to the migrations API with sequential version numbers.
2. THE Platform SHALL create these tables: organizations, organization_members, contacts, conversations, messages, sms_provider_accounts, sms_phone_numbers, sms_delivery_events, email_provider_accounts, email_addresses, email_delivery_events, ai_settings, ai_decisions, knowledge_documents, knowledge_chunks, support_jobs, and audit_logs.
3. THE Platform SHALL enable the pgvector extension and use a vector column on the knowledge_chunks table for embedding storage.
4. THE Platform SHALL define foreign key constraints between all related tables to enforce referential integrity.
5. THE Platform SHALL define indexes on frequently queried columns including: organization_id on all tenant-scoped tables, (provider, external_message_id) on messages, contact_id on conversations, and the vector column on knowledge_chunks using an ivfflat or hnsw index.

---

### Requirement 15: Row Level Security

**User Story:** As a security engineer, I want row-level security on all tables, so that users can only access data belonging to their organization.

#### Acceptance Criteria

1. THE Platform SHALL enable Row Level Security on every tenant-scoped table.
2. THE RLS_Policy SHALL restrict SELECT, INSERT, UPDATE, and DELETE operations to rows where the organization_id matches the requesting user's Organization membership.
3. THE RLS_Policy SHALL extract the user identity from the JWT token provided in the request.
4. THE RLS_Policy SHALL deny access to any row where the requesting user is not a Member of the owning Organization.
5. THE Platform SHALL ensure that provider credentials stored in sms_provider_accounts and email_provider_accounts are accessible only through server-side Function_Entrypoints and are excluded from client-side queries.

---

### Requirement 16: InsForge Serverless Functions

**User Story:** As a developer, I want thin serverless function entrypoints, so that business logic remains portable and testable outside InsForge.

#### Acceptance Criteria

1. THE Platform SHALL deploy 14 Function_Entrypoints: sms-inbound, sms-status, email-inbound, email-status, send-reply, approve-ai-draft, regenerate-ai-draft, process-ai-job, process-knowledge-document, process-jobs, escalate-conversation, resolve-conversation, reopen-conversation, and test-channel-connection.
2. Each Function_Entrypoint SHALL follow the Deno handler pattern: `export default async function(req: Request): Promise<Response>`.
3. Each Function_Entrypoint SHALL contain only request parsing, authentication verification, delegation to a portable service module, and response formatting.
4. Each Function_Entrypoint SHALL access environment configuration via `Deno.env.get()` for INSFORGE_BASE_URL and ANON_KEY.
5. IF a Function_Entrypoint receives a request that fails authentication, THEN THE Function_Entrypoint SHALL return HTTP 401 with an error message.
6. IF a Function_Entrypoint encounters an unhandled error, THEN THE Function_Entrypoint SHALL return HTTP 500, log the error, and record an Audit_Log entry.

---

### Requirement 17: Frontend — Authentication Pages

**User Story:** As a user, I want login and registration pages, so that I can access the Platform securely.

#### Acceptance Criteria

1. WHEN a user navigates to /login, THE Frontend SHALL display a sign-in form with email and password fields.
2. WHEN a user submits valid credentials on /login, THE Frontend SHALL authenticate via the Auth_Service and redirect to /inbox.
3. IF authentication fails, THEN THE Frontend SHALL display an error message without revealing whether the email exists.
4. WHEN an unauthenticated user navigates to any protected route, THE Frontend SHALL redirect to /login.

---

### Requirement 18: Frontend — Inbox

**User Story:** As an agent, I want a full-featured inbox, so that I can view and respond to customer conversations.

#### Acceptance Criteria

1. WHEN an agent navigates to /inbox, THE Frontend SHALL display a conversation list panel showing all open and escalated Conversations for the Organization, sorted by last_message_at descending.
2. WHEN an agent selects a Conversation, THE Frontend SHALL display the message thread with all Messages in chronological order, a contact details panel, and the AI draft panel if an AI_Decision with status "drafted" exists.
3. WHEN an agent types and submits a reply in the composer, THE Frontend SHALL invoke the send-reply Function_Entrypoint and display the sent Message in the thread.
4. WHEN an AI draft exists for the selected Conversation, THE Frontend SHALL display the draft with "Approve" and "Regenerate" action buttons.
5. WHEN an agent clicks "Approve" on an AI draft, THE Frontend SHALL invoke the approve-ai-draft Function_Entrypoint and send the drafted response to the Contact.
6. WHEN an agent clicks "Regenerate" on an AI draft, THE Frontend SHALL invoke the regenerate-ai-draft Function_Entrypoint and display the new draft when available.
7. WHEN a new Message arrives for a Conversation visible in the inbox, THE Realtime_Service SHALL push the update and THE Frontend SHALL append the Message to the thread without requiring a page refresh.

---

### Requirement 19: Frontend — Knowledge Management

**User Story:** As an admin, I want a knowledge management page, so that I can add and manage documents for the AI_Agent.

#### Acceptance Criteria

1. WHEN an admin navigates to /knowledge, THE Frontend SHALL display a list of all Knowledge_Base documents with title, source_type, status, and timestamps.
2. WHEN an admin clicks "Add Document", THE Frontend SHALL display a form to enter title, source_type, and body content.
3. WHEN an admin submits a new document, THE Frontend SHALL create the document record and display the document with status "pending".
4. WHEN a document's status changes (via the Ingestion_Pipeline), THE Realtime_Service SHALL push the update and THE Frontend SHALL reflect the new status without requiring a page refresh.
5. WHEN an admin deletes a document, THE Frontend SHALL confirm the action and then remove the document and its associated chunks.

---

### Requirement 20: Frontend — Settings Pages

**User Story:** As an admin, I want settings pages for AI, SMS, and email configuration, so that I can customize the Platform for my organization.

#### Acceptance Criteria

1. WHEN an admin navigates to /settings/ai, THE Frontend SHALL display the current AI mode (off, draft_only, auto_reply), confidence threshold, context window size, and escalation keyword list, with controls to modify each setting.
2. WHEN an admin navigates to /settings/sms, THE Frontend SHALL display configured SMS Provider_Accounts and Phone_Numbers, with controls to add, edit, or remove them.
3. WHEN an admin navigates to /settings/email, THE Frontend SHALL display configured email Provider_Accounts and Email_Addresses, with controls to add, edit, or remove them.
4. WHEN an admin saves settings changes, THE Frontend SHALL persist the changes and record an Audit_Log entry.
5. WHEN an admin clicks "Test Connection" for a provider, THE Frontend SHALL invoke the test-channel-connection Function_Entrypoint and display the result (success or failure with error details).

---

### Requirement 21: Frontend — Analytics Dashboard

**User Story:** As an owner, I want an analytics dashboard, so that I can monitor support performance.

#### Acceptance Criteria

1. WHEN a user navigates to /analytics, THE Frontend SHALL display summary metrics: total Conversations, open Conversations, resolved Conversations, escalated Conversations, average response time, and AI auto-reply rate.
2. THE Frontend SHALL compute metrics based on data from the current Organization only, filtered by a configurable date range.
3. THE Frontend SHALL display metrics using visual charts or summary cards.

---

### Requirement 22: Audit Logging

**User Story:** As an owner, I want all significant actions logged, so that I can review activity for compliance and debugging.

#### Acceptance Criteria

1. THE Platform SHALL record an Audit_Log entry for each of these actions: message sent, message received, AI_Decision produced, Conversation escalated, Conversation resolved, Conversation reopened, settings changed, Member added, Member removed, Member role changed, knowledge document created, knowledge document deleted, and provider account modified.
2. THE Platform SHALL store each Audit_Log entry with: id, organization_id, actor_id, actor_type (user, system, ai), action, resource_type, resource_id, metadata (JSONB), and created_at.
3. THE Audit_Log SHALL be append-only; THE Platform SHALL not permit updates or deletions of Audit_Log records.

---

### Requirement 23: Webhook Security

**User Story:** As a security engineer, I want webhook endpoints to verify request authenticity, so that the Platform rejects forged webhook calls.

#### Acceptance Criteria

1. WHEN an SMS inbound or status webhook is received, THE SMS_Gateway SHALL call the verifyWebhook method of the configured adapter to validate the request signature.
2. WHEN an email inbound or status webhook is received, THE Email_Gateway SHALL call the verifyWebhook method of the configured adapter to validate the request signature.
3. IF webhook signature verification fails, THEN THE Function_Entrypoint SHALL return HTTP 401 and discard the request.
4. THE Platform SHALL store provider webhook signing secrets in InsForge encrypted secrets management, not in database tables or environment variables exposed to the client.

---

### Requirement 24: Credential Security

**User Story:** As a security engineer, I want provider credentials encrypted and server-side only, so that API keys are never exposed to the browser.

#### Acceptance Criteria

1. THE Platform SHALL store provider API keys and secrets in InsForge's AES-256-GCM encrypted secrets management.
2. THE Platform SHALL access provider credentials only within server-side Function_Entrypoints.
3. THE RLS_Policy SHALL exclude credential columns from any client-accessible query result.
4. IF a client-side request attempts to read credential columns, THEN THE Platform SHALL return the row without credential data.

---

### Requirement 25: Portability and Lock-in Avoidance

**User Story:** As a technical lead, I want the architecture to minimize InsForge lock-in, so that the Platform can migrate to another backend if needed.

#### Acceptance Criteria

1. THE Platform SHALL define the database schema using standard PostgreSQL SQL without InsForge-proprietary extensions (except pgvector).
2. THE Platform SHALL implement all SMS logic within provider-neutral adapter modules that do not import InsForge SDK.
3. THE Platform SHALL implement all email logic within provider-neutral adapter modules that do not import InsForge SDK.
4. THE Platform SHALL implement all AI logic within a reusable package that accepts an AI client interface rather than depending on InsForge SDK directly.
5. THE Platform SHALL implement all job queue logic behind a JobQueue interface that does not expose Postgres-specific implementation details to callers.
6. THE Platform SHALL implement all data access through Repository modules that encapsulate InsForge SDK database calls, so that business logic modules do not import InsForge SDK directly.
7. Each Function_Entrypoint SHALL contain only request handling and delegation; business logic SHALL reside in portable service modules.

---

### Requirement 26: Realtime Updates

**User Story:** As an agent, I want live updates in the inbox, so that I see new messages and status changes without refreshing the page.

#### Acceptance Criteria

1. WHEN a new Message is inserted, THE Realtime_Service SHALL publish an event on the Organization's channel containing the Message data.
2. WHEN a Conversation status or ai_state changes, THE Realtime_Service SHALL publish an event on the Organization's channel containing the updated Conversation data.
3. WHEN a Knowledge_Base document status changes, THE Realtime_Service SHALL publish an event on the Organization's channel containing the updated document data.
4. THE Frontend SHALL subscribe to the Organization's Realtime_Service channel on page load and update the UI in response to received events.

---

### Requirement 27: Seed Data

**User Story:** As a developer, I want seed data for local development, so that I can test the Platform without manual setup.

#### Acceptance Criteria

1. THE Platform SHALL provide a seed script that creates: one Organization, one owner Member, three Contacts, five Conversations across SMS and email channels, ten Messages with varied sender_types and directions, two Knowledge_Base documents with chunks and embeddings, and sample AI settings.
2. THE seed script SHALL be idempotent; running the script multiple times SHALL not create duplicate records.

---

### Requirement 28: Documentation

**User Story:** As a developer, I want a comprehensive README, so that I can set up and run the Platform locally.

#### Acceptance Criteria

1. THE Platform SHALL include a README.md file with: project overview, prerequisites, environment setup instructions, database migration instructions, seed data instructions, function deployment instructions, frontend development server instructions, and architecture overview.
2. THE README.md SHALL document all required environment variables and InsForge configuration values.

---

### Requirement 29: Testing

**User Story:** As a developer, I want automated tests for critical business logic, so that I can verify correctness and prevent regressions.

#### Acceptance Criteria

1. THE Platform SHALL include tests for SMS webhook payload normalization that verify correct parsing across mock, Twilio, and Telnyx adapters.
2. THE Platform SHALL include tests for email webhook payload normalization that verify correct parsing across mock and the implemented real adapter.
3. THE Platform SHALL include tests for message idempotency that verify duplicate webhooks with the same external_message_id are discarded.
4. THE Platform SHALL include tests for outbound message sending that verify correct adapter invocation and Message record creation.
5. THE Platform SHALL include tests for AI_Decision JSON parsing that verify valid JSON is accepted and invalid JSON triggers a failure state.
6. THE Platform SHALL include tests for Escalation_Engine rules that verify each escalation trigger produces the correct escalation decision.
7. THE Platform SHALL include tests for Knowledge_Base semantic search that verify match_knowledge_chunks returns relevant chunks ranked by similarity.
8. THE Platform SHALL include tests for Job_Queue claim logic that verify atomic claiming with SELECT FOR UPDATE SKIP LOCKED, retry with exponential backoff, and dead-lettering after max_attempts.
9. FOR ALL valid AI_Decision JSON objects, parsing then serializing then parsing SHALL produce an equivalent AI_Decision object (round-trip property).
10. FOR ALL valid webhook payloads, normalizing then serializing then normalizing SHALL produce an equivalent normalized payload (round-trip property).

---

### Requirement 30: Accessibility

**User Story:** As a user with disabilities, I want the Frontend to be accessible, so that I can use the Platform with assistive technologies.

#### Acceptance Criteria

1. THE Frontend SHALL comply with WCAG 2.1 Level AA guidelines for all interactive elements including forms, buttons, navigation, and conversation threads.
2. THE Frontend SHALL provide keyboard navigation for all primary workflows: login, inbox browsing, message composition, and settings management.
3. THE Frontend SHALL use semantic HTML elements and ARIA attributes to convey structure and state to screen readers.

---

## Cross-references

- **Pricing & packaging hypothesis (3 tiers, gating schema, design-partner profiles):** `docs/PRICING.md` (sibling to this requirements doc; the tier boundaries it defines — Starter / Growth / Scale — are enforced via `organization_subscriptions`, `ai_settings.ai_mode`, `organization_members` count, and `knowledge_documents` count, all referenced from this document)
