/**
 * Create / Input types — paired 1:1 with the entity types in `./entities`.
 *
 * Repositories accept these (rather than full entities) on `create()` so that
 * server-generated fields (id, createdAt, updatedAt) cannot be smuggled in
 * by callers. Fields that are optional on the entity but always required for
 * creation are still required here.
 *
 * Files in this module deliberately use `import type` only — at runtime these
 * types are erased, so no value is imported from `./enums` / `./ai-models`.
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
  JobType,
  MemberRole,
  MessageDirection,
  SenderType,
} from './enums';

// ─── Tenancy ─────────────────────────────────────────────────────────

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

// ─── Contacts & conversations ────────────────────────────────────────

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
  lastMessageAt?: Date | null;
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

// ─── AI ──────────────────────────────────────────────────────────────

export interface CreateAiSettingsInput {
  organizationId: string;
  aiMode?: AiMode;
  confidenceThreshold?: number;
  contextWindowSize?: number;
  maxConsecutiveFailures?: number;
  knowledgeSimilarityThreshold?: number;
  escalationKeywords?: string[];
  systemPrompt?: string | null;
  model?: ModelId;
  embeddingModel?: EmbeddingModelId;
}

export interface CreateAiDecisionInput {
  conversationId: string;
  organizationId: string;
  sourceJobId?: string | null;
  messageId?: string | null;
  decisionType: AiDecisionType;
  confidence: number;
  reasoningSummary?: string | null;
  responseText?: string | null;
  tags?: string[];
  requiresHuman: boolean;
  rawResponse?: Record<string, unknown> | null;
}

// ─── Knowledge base ──────────────────────────────────────────────────

export interface CreateDocumentInput {
  organizationId: string;
  title: string;
  sourceType: string;
  body: string;
  contentRevision?: string;
  fileUrl?: string | null;
  fileName?: string | null;
  fileKey?: string | null;
}

export interface CreateChunkInput {
  documentId: string;
  organizationId: string;
  content: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
}

// ─── Job queue ───────────────────────────────────────────────────────

export interface CreateJobInput {
  organizationId: string;
  jobType: JobType;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
  runAfter?: Date;
}

// ─── Audit log ───────────────────────────────────────────────────────

export interface CreateAuditLogInput {
  organizationId: string;
  actorId?: string | null;
  actorType: ActorType;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
}

// ─── Provider accounts & delivery events ─────────────────────────────

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
