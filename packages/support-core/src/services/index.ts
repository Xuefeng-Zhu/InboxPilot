// Service layer — orchestrates business logic
export { InboundMessageService } from './inbound-message-service.js';
export {
  OutboundMessageService,
  OutboundMessagePostDispatchError,
} from './outbound-message-service.js';
export type {
  OutboundMessageActor,
  OutboundDispatchReceipt,
  OutboundMessageFinalizationStage,
} from './outbound-message-service.js';
export { PostgresJobQueue, createJobIdempotencyKey } from './postgres-job-queue.js';
export { resolveOutboundProviderConfig } from './outbound-provider-config.js';
export type { OutboundProviderConfigDependencies } from './outbound-provider-config.js';
export { AiDecisionRecorder } from './ai-decision-recorder.js';
export { buildAiPrompt } from './ai-prompt-builder.js';
export { KnowledgeIngestionService } from './knowledge-ingestion-service.js';
export { AiAgentService } from './ai-agent-service.js';
export { parseAiDecision, AiDecisionSchema } from './ai-decision-parser.js';
export type { ParsedAiDecision, ParseAiDecisionResult } from './ai-decision-parser.js';
export {
  HumanRequestRule,
  ProfanityAngerRule,
  SensitiveTopicRule,
  SafetyConcernRule,
  MissingKnowledgeRule,
  LowConfidenceRule,
  RepeatedFailureRule,
  KeywordRule,
  createDefaultEscalationEngine,
} from './escalation-rules.js';
export { OrganizationService } from './organization-service.js';
export { WebchatWidgetService } from './webchat-widget-service.js';
export {
  hasPermission,
  checkPermission,
  ROLE_PERMISSIONS,
  ALL_PERMISSIONS,
} from './rbac.js';
export type { Permission } from './rbac.js';
