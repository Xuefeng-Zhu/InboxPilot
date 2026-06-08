/**
 * Shared entity types for InboxPilot.
 * These types mirror the database schema columns and are used across
 * all layers (repositories, services, adapters, function entrypoints).
 */

// ─── Enums / Union Types ────────────────────────────────────────────

export type Channel = 'sms' | 'email';

export type ConversationStatus = 'open' | 'pending' | 'resolved' | 'escalated';

export type AiState =
  | 'idle'
  | 'thinking'
  | 'drafted'
  | 'auto_replied'
  | 'needs_human'
  | 'failed';

export type SenderType = 'contact' | 'user' | 'ai' | 'system';

export type MessageDirection = 'inbound' | 'outbound';

export type DeliveryStatus =
  | 'pending'
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'bounced';

export type AiMode = 'off' | 'draft_only' | 'auto_reply';

export type AiDecisionType = 'respond' | 'escalate' | 'clarify';

export type MemberRole = 'owner' | 'admin' | 'agent' | 'viewer';

export type JobType =
  | 'process_ai_message'
  | 'process_knowledge_document'
  | 'send_outbound_message'
  | 'process_delivery_status'
  | 'retry_failed_jobs';

export type JobStatus = 'pending' | 'claimed' | 'completed' | 'failed' | 'dead';

export type KnowledgeDocumentStatus = 'pending' | 'processing' | 'ready' | 'failed';

export type ActorType = 'user' | 'system' | 'ai';

// ─── Entity Types ───────────────────────────────────────────────────

export interface Organization {
  id: string;
  name: string;
  slug: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationMember {
  id: string;
  organizationId: string;
  userId: string;
  role: MemberRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface Contact {
  id: string;
  organizationId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface Conversation {
  id: string;
  organizationId: string;
  contactId: string;
  channel: Channel;
  status: ConversationStatus;
  aiState: AiState;
  subject: string | null;
  assignedTo: string | null;
  lastMessageAt: Date | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  id: string;
  conversationId: string;
  senderType: SenderType;
  senderId: string | null;
  direction: MessageDirection;
  channel: Channel;
  body: string;
  subject: string | null;
  rawPayload: Record<string, unknown>;
  provider: string | null;
  providerAccountId: string | null;
  externalMessageId: string | null;
  deliveryStatus: DeliveryStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface SmsProviderAccount {
  id: string;
  organizationId: string;
  provider: string;
  label: string;
  credentialsSecretId: string;
  isActive: boolean;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface SmsPhoneNumber {
  id: string;
  providerAccountId: string;
  organizationId: string;
  phoneNumber: string;
  isDefault: boolean;
  createdAt: Date;
}

export interface SmsDeliveryEvent {
  id: string;
  messageId: string;
  providerAccountId: string | null;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  rawPayload: Record<string, unknown>;
  createdAt: Date;
}

export interface EmailProviderAccount {
  id: string;
  organizationId: string;
  provider: string;
  label: string;
  credentialsSecretId: string;
  isActive: boolean;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmailAddress {
  id: string;
  providerAccountId: string;
  organizationId: string;
  emailAddress: string;
  isDefault: boolean;
  createdAt: Date;
}

export interface EmailDeliveryEvent {
  id: string;
  messageId: string;
  providerAccountId: string | null;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  rawPayload: Record<string, unknown>;
  createdAt: Date;
}

export interface AiSettings {
  id: string;
  organizationId: string;
  aiMode: AiMode;
  confidenceThreshold: number;
  contextWindowSize: number;
  maxConsecutiveFailures: number;
  knowledgeSimilarityThreshold: number;
  escalationKeywords: string[];
  systemPrompt: string | null;
  model: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AiDecision {
  id: string;
  conversationId: string;
  organizationId: string;
  messageId: string | null;
  decisionType: AiDecisionType;
  confidence: number;
  reasoningSummary: string | null;
  responseText: string | null;
  tags: string[];
  requiresHuman: boolean;
  rawResponse: Record<string, unknown> | null;
  createdAt: Date;
}

export interface KnowledgeDocument {
  id: string;
  organizationId: string;
  title: string;
  sourceType: string;
  body: string;
  status: KnowledgeDocumentStatus;
  errorMessage: string | null;
  fileUrl: string | null;
  fileName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeChunk {
  id: string;
  documentId: string;
  organizationId: string;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface Job {
  id: string;
  organizationId: string;
  jobType: JobType;
  payload: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  runAfter: Date;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface AuditLog {
  id: string;
  organizationId: string;
  actorId: string | null;
  actorType: ActorType;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

// ─── Provider Config ────────────────────────────────────────────────

export interface ProviderConfig {
  [key: string]: unknown;
}

// ─── Normalized Webhook Types ───────────────────────────────────────

export interface NormalizedInboundSms {
  from: string;
  to: string;
  body: string;
  externalMessageId: string;
  rawPayload: Record<string, unknown>;
}

export interface NormalizedInboundEmail {
  from: string;
  to: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  externalMessageId: string;
  inReplyTo?: string;
  rawPayload: Record<string, unknown>;
}

export interface NormalizedDeliveryStatus {
  externalMessageId: string;
  status: DeliveryStatus;
  errorCode?: string;
  errorMessage?: string;
  rawPayload: Record<string, unknown>;
}

export interface WebhookVerificationRequest {
  headers: Record<string, string>;
  body: string | Buffer;
  signingSecret: string;
}

// ─── Send Params / Results ──────────────────────────────────────────

export interface SendSmsParams {
  to: string;
  from: string;
  body: string;
  providerConfig: ProviderConfig;
}

export interface SendSmsResult {
  externalMessageId: string;
  provider: string;
  status: 'queued' | 'sent';
}

export interface SendEmailParams {
  to: string;
  from: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  replyToMessageId?: string;
  providerConfig: ProviderConfig;
}

export interface SendEmailResult {
  externalMessageId: string;
  provider: string;
  status: 'queued' | 'sent';
}

// ─── AI Client Types ────────────────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionParams {
  model: string;
  messages: ChatMessage[];
  responseFormat?: { type: 'json_object' };
  temperature?: number;
}

export interface ChatCompletionResult {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface EmbeddingParams {
  model: string;
  input: string;
}

// ─── Create / Input Types ───────────────────────────────────────────

export interface CreateContactInput {
  organizationId: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreateConversationInput {
  organizationId: string;
  contactId: string;
  channel: Channel;
  status?: ConversationStatus;
  aiState?: AiState;
  subject?: string | null;
}

export interface CreateMessageInput {
  conversationId: string;
  senderType: SenderType;
  senderId?: string | null;
  direction: MessageDirection;
  channel: Channel;
  body: string;
  subject?: string | null;
  rawPayload?: Record<string, unknown>;
  provider?: string | null;
  providerAccountId?: string | null;
  externalMessageId?: string | null;
  deliveryStatus?: DeliveryStatus;
}

export interface CreateDocumentInput {
  organizationId: string;
  title: string;
  sourceType: string;
  body: string;
}

export interface CreateChunkInput {
  documentId: string;
  organizationId: string;
  content: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
}

export interface CreateAuditLogInput {
  organizationId: string;
  actorId?: string | null;
  actorType: ActorType;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreateOrganizationInput {
  name: string;
  slug: string;
  metadata?: Record<string, unknown>;
}

export interface CreateMemberInput {
  organizationId: string;
  userId: string;
  role: MemberRole;
}

export interface CreateAiSettingsInput {
  organizationId: string;
  aiMode?: AiMode;
  confidenceThreshold?: number;
  contextWindowSize?: number;
  maxConsecutiveFailures?: number;
  knowledgeSimilarityThreshold?: number;
  escalationKeywords?: string[];
  systemPrompt?: string | null;
  model?: string;
}

export interface CreateAiDecisionInput {
  conversationId: string;
  organizationId: string;
  messageId?: string | null;
  decisionType: AiDecisionType;
  confidence: number;
  reasoningSummary?: string | null;
  responseText?: string | null;
  tags?: string[];
  requiresHuman: boolean;
  rawResponse?: Record<string, unknown> | null;
}

export interface CreateJobInput {
  organizationId: string;
  jobType: JobType;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
  runAfter?: Date;
}

export interface CreateSmsProviderAccountInput {
  organizationId: string;
  provider: string;
  label: string;
  credentialsSecretId: string;
  isActive?: boolean;
  metadata?: Record<string, unknown>;
}

export interface CreateEmailProviderAccountInput {
  organizationId: string;
  provider: string;
  label: string;
  credentialsSecretId: string;
  isActive?: boolean;
  metadata?: Record<string, unknown>;
}

export interface CreateDeliveryEventInput {
  messageId: string;
  providerAccountId?: string | null;
  status: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  rawPayload?: Record<string, unknown>;
}

// ─── Filter Types ───────────────────────────────────────────────────

export interface ConversationFilters {
  status?: ConversationStatus;
  channel?: Channel;
  assignedTo?: string;
  limit?: number;
  offset?: number;
}
