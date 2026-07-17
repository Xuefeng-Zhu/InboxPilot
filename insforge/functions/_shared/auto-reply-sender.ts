import { createProviderRegistry } from './create-provider-registry.ts';
import { getSecret } from './insforge-secrets.ts';
import { publishRealtimeBestEffort } from './publish-realtime-best-effort.ts';
import { reconcileAcceptedDispatch } from './accepted-dispatch-reconciliation.ts';
import { NonRetryableJobError } from './run-claimed-job.ts';
import { ProviderSendOutcomeUnknownError } from '../../../packages/support-core/src/adapters/provider-send-outcome-unknown-error.ts';
import {
  OutboundMessagePostDispatchError,
  OutboundMessageService,
} from '../../../packages/support-core/src/services/outbound-message-service.ts';
import { resolveOutboundProviderConfig } from '../../../packages/support-core/src/services/outbound-provider-config.ts';
import { ConversationRepository } from '../../../packages/support-core/src/repositories/conversation-repository.ts';
import { MessageRepository } from '../../../packages/support-core/src/repositories/message-repository.ts';
import { AuditLogRepository } from '../../../packages/support-core/src/repositories/audit-log-repository.ts';
import { AiDecisionRepository } from '../../../packages/support-core/src/repositories/ai-decision-repository.ts';
import { ContactRepository } from '../../../packages/support-core/src/repositories/contact-repository.ts';
import { WebchatThreadRepository } from '../../../packages/support-core/src/repositories/webchat-thread-repository.ts';
import { SmsProviderAccountRepository } from '../../../packages/support-core/src/repositories/sms-provider-account-repository.ts';
import { EmailProviderAccountRepository } from '../../../packages/support-core/src/repositories/email-provider-account-repository.ts';
import type { DatabaseClient } from '../../../packages/support-core/src/interfaces/database-client.ts';
import type { RealtimePublisher } from '../../../packages/support-core/src/interfaces/realtime-publisher.ts';
import type {
  Channel,
  Conversation,
  CreateAuditLogInput,
  Message,
} from '../../../packages/support-core/src/types/index.ts';

export type AutoReplySender = (
  conversationId: string,
  body: string,
  aiDecisionId: string | null,
) => Promise<void>;

/** Small operation surface used to test delivery policy independently of I/O wiring. */
export interface AutoReplySenderOperations {
  findConversation(conversationId: string): Promise<Conversation | null>;
  resolveProviderConfig(
    organizationId: string,
    channel: Channel,
  ): Promise<Record<string, unknown>>;
  sendReply(
    conversationId: string,
    body: string,
    providerConfig: Record<string, unknown>,
  ): Promise<Message>;
  updateDecision(
    aiDecisionId: string,
    metadata: Record<string, unknown>,
  ): Promise<void>;
  writeAudit(input: CreateAuditLogInput): Promise<void>;
  findWebchatThread(
    conversationId: string,
  ): Promise<{ widgetId: string; visitorTokenJti: string } | null>;
  publishRealtime(
    channel: string,
    event: string,
    data: unknown,
    context: string,
  ): Promise<boolean>;
  logError(message: string): void;
}

/**
 * Create the delivery policy from a narrow set of operations. The production
 * factory below owns repository/provider construction; tests can exercise
 * retry-boundary and reconciliation behavior without a database or network.
 */
export function createAutoReplySenderWithOperations(
  operations: AutoReplySenderOperations,
): AutoReplySender {
  return async (conversationId, body, aiDecisionId) => {
    const conversation = await operations.findConversation(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const providerConfig = await operations.resolveProviderConfig(
      conversation.organizationId,
      conversation.channel,
    );

    let message: Message | null = null;
    let finalizationError: OutboundMessagePostDispatchError | null = null;
    try {
      message = await operations.sendReply(conversationId, body, providerConfig);
    } catch (error) {
      if (error instanceof ProviderSendOutcomeUnknownError) {
        throw new NonRetryableJobError(
          `Provider send outcome is unknown; automatic retry suppressed: ${error.message}`,
          error,
        );
      }
      if (error instanceof OutboundMessagePostDispatchError) {
        finalizationError = error;
        operations.logError(
          `sendAutoReply: delivery finalization failed at ${error.stage}; ` +
            'suppressing automatic retry — ' + error.message,
        );
        if (error.dispatchedMessage) {
          message = error.dispatchedMessage;
        } else {
          await reconcileAcceptedDispatch({
            error,
            aiDecisionId,
            updateDecision: async (metadata) => {
              if (!aiDecisionId) return;
              await operations.updateDecision(aiDecisionId, metadata);
            },
            writeAudit: async (metadata) => {
              await operations.writeAudit({
                organizationId: conversation.organizationId,
                actorId: null,
                actorType: 'ai',
                action: 'message_sent',
                resourceType: 'message',
                resourceId: null,
                metadata: {
                  trigger: 'auto_reply',
                  conversationId: conversation.id,
                  ...metadata,
                },
              });
            },
            logError: (message) => operations.logError(`sendAutoReply: ${message}`),
          });
          return;
        }
      }
      if (!(error instanceof OutboundMessagePostDispatchError)) {
        throw error;
      }
    }

    if (!message) {
      throw new Error('sendAutoReply completed without a persisted message');
    }

    if (finalizationError) {
      await reconcileAcceptedDispatch({
        error: finalizationError,
        aiDecisionId,
        updateDecision: async (metadata) => {
          if (!aiDecisionId) return;
          await operations.updateDecision(aiDecisionId, {
            ...metadata,
            messageId: message.id,
            sentAt: new Date().toISOString(),
          });
        },
        writeAudit: async (metadata) => {
          await operations.writeAudit({
            organizationId: conversation.organizationId,
            actorId: null,
            actorType: 'ai',
            action: 'message_sent',
            resourceType: 'message',
            resourceId: message.id,
            metadata: {
              trigger: 'auto_reply',
              channel: conversation.channel,
              conversationId: conversation.id,
              ...metadata,
            },
          });
        },
        logError: (message) => operations.logError(`sendAutoReply: ${message}`),
      });
    } else {
      try {
        await operations.writeAudit({
          organizationId: conversation.organizationId,
          actorId: null,
          actorType: 'ai',
          action: 'message_sent',
          resourceType: 'message',
          resourceId: message.id,
          metadata: {
            trigger: 'auto_reply',
            channel: conversation.channel,
            conversationId: conversation.id,
          },
        });
      } catch (error) {
        operations.logError(
          `sendAutoReply: failed to write ai audit log for message ${message.id}: ` +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    }

    if (conversation.channel === 'webchat') {
      try {
        const thread = await operations.findWebchatThread(conversation.id);
        if (thread) {
          await operations.publishRealtime(
            `widget:${thread.widgetId}:${thread.visitorTokenJti}`,
            'new_message',
            { message, conversationId: message.conversationId },
            `sendAutoReply message ${message.id}`,
          );
        }
      } catch (error) {
        operations.logError(
          `sendAutoReply: failed to resolve webchat thread for persisted message ${message.id}: ` +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    }

    await operations.publishRealtime(
      `org:${conversation.organizationId}`,
      'new_message',
      {
        message,
        conversationId: message.conversationId,
      },
      `sendAutoReply message ${message.id}`,
    );

    if (aiDecisionId && !finalizationError) {
      try {
        await operations.updateDecision(aiDecisionId, {
          autoSent: true,
          sentAt: new Date().toISOString(),
        });
      } catch (error) {
        operations.logError(
          `sendAutoReply: failed to update AI decision ${aiDecisionId} metadata after sending ` +
            `message ${message.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  };
}

/** Build the production auto-reply sender used by process-jobs. */
export function createAutoReplySender(input: {
  db: DatabaseClient;
  baseUrl: string;
  serviceRoleKey: string;
  realtime: RealtimePublisher;
}): AutoReplySender {
  return async (conversationId, body, aiDecisionId) => {
    const conversationRepo = new ConversationRepository(input.db);
    const messageRepo = new MessageRepository(input.db);
    const contactRepo = new ContactRepository(input.db);
    const webchatThreadRepo = new WebchatThreadRepository(input.db);
    const auditLogRepo = new AuditLogRepository(input.db);
    const aiDecisionRepo = new AiDecisionRepository(input.db);
    const smsAccountRepo = new SmsProviderAccountRepository(input.db);
    const emailAccountRepo = new EmailProviderAccountRepository(input.db);
    const outboundService = new OutboundMessageService(
      conversationRepo,
      contactRepo,
      messageRepo,
      createProviderRegistry(),
      smsAccountRepo,
      emailAccountRepo,
      auditLogRepo,
    );

    const sender = createAutoReplySenderWithOperations({
      findConversation: (id) => conversationRepo.findById(id),
      resolveProviderConfig: (organizationId, channel) => resolveOutboundProviderConfig(
        organizationId,
        channel,
        {
          smsAccountRepo,
          emailAccountRepo,
          loadSecret: (secretId) => getSecret<Record<string, unknown>>(
            secretId,
            input.baseUrl,
            input.serviceRoleKey,
          ),
        },
      ),
      sendReply: (id, replyBody, providerConfig) => outboundService.sendReply(
        id,
        replyBody,
        { type: 'ai', id: null },
        providerConfig,
        { writeAuditLog: false },
      ),
      updateDecision: async (id, metadata) => {
        await aiDecisionRepo.update(id, { metadata });
      },
      writeAudit: async (auditInput) => {
        await auditLogRepo.create(auditInput);
      },
      findWebchatThread: (id) => webchatThreadRepo.findByConversationId(id),
      publishRealtime: (channel, event, data, context) => publishRealtimeBestEffort(
        input.realtime,
        channel,
        event,
        data,
        context,
      ),
      logError: (message) => console.error(message),
    });

    await sender(conversationId, body, aiDecisionId);
  };
}
