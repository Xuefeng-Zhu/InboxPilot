/**
 * Enums and union types for InboxPilot.
 *
 * These literal-union types mirror the corresponding PostgreSQL CHECK constraints
 * and enum-ish text columns. Keep this file dependency-free (no imports from
 * sibling type files) so it can sit at the bottom of the type-dependency graph.
 */

// ─── Communication channels & state ──────────────────────────────────

export type Channel = 'sms' | 'email' | 'webchat';

export type ConversationStatus = 'open' | 'resolved' | 'escalated';

export type SenderType = 'contact' | 'user' | 'ai' | 'system';

export type MessageDirection = 'inbound' | 'outbound';

export type DeliveryStatus =
  | 'pending'
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'bounced';

// ─── AI / automation ─────────────────────────────────────────────────

export type AiState =
  | 'idle'
  | 'thinking'
  | 'drafted'
  | 'auto_replied'
  | 'needs_human'
  | 'failed';

export type AiMode = 'off' | 'draft_only' | 'auto_reply';

export type AiDecisionType = 'respond' | 'escalate' | 'clarify';

// ─── Tenancy & roles ─────────────────────────────────────────────────

export type MemberRole = 'owner' | 'admin' | 'agent' | 'viewer';

export type ActorType = 'user' | 'system' | 'ai';

// ─── Job queue ───────────────────────────────────────────────────────

export type JobType =
  | 'process_ai_message'
  | 'process_knowledge_document'
  | 'send_outbound_message'
  | 'process_delivery_status'
  | 'record_chunk_refs'
  | 'retry_failed_jobs';

export type JobStatus = 'pending' | 'claimed' | 'completed' | 'failed' | 'dead';

// ─── Knowledge base ──────────────────────────────────────────────────

export type KnowledgeDocumentStatus = 'pending' | 'processing' | 'ready' | 'failed';
