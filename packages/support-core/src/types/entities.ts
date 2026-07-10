/**
 * Entity types — mirror the InboxPilot database schema columns.
 *
 * All entity fields use camelCase (DB rows are snake_case; row-mapping happens
 * inside each repository's private `toEntity()` / `toRow()` functions).
 *
 * These types are the canonical return shape for repositories and the
 * canonical input shape for services. Callers must never see raw DB rows.
 */

import type { EmbeddingModelId, ModelId } from './ai-models';
import type {
  ActorType,
  AiDecisionType,
  AiMode,
  AiState,
  Channel,
  ConversationStatus,
  DeliveryStatus,
  JobStatus,
  JobType,
  KnowledgeDocumentStatus,
  MemberRole,
  MessageDirection,
  SenderType,
} from './enums';

// ─── Tenancy ─────────────────────────────────────────────────────────

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

// ─── Contacts & conversations ────────────────────────────────────────

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

// ─── SMS provider accounts & delivery events ─────────────────────────

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

// ─── Email provider accounts & delivery events ───────────────────────

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

// ─── AI settings & decisions ─────────────────────────────────────────

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
  model: ModelId;
  embeddingModel: EmbeddingModelId;
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

// ─── Knowledge base ──────────────────────────────────────────────────

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
  fileKey: string | null;
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

// ─── Job queue ───────────────────────────────────────────────────────

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

// ─── Audit log ───────────────────────────────────────────────────────

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
