import type { DatabaseClient } from '../../../packages/support-core/src/interfaces/database-client.ts';
import type { DeliveryStatus, Message } from '../../../packages/support-core/src/types/index.ts';
import { AuditLogRepository } from '../../../packages/support-core/src/repositories/audit-log-repository.ts';
import { ContactRepository } from '../../../packages/support-core/src/repositories/contact-repository.ts';
import { ConversationRepository } from '../../../packages/support-core/src/repositories/conversation-repository.ts';
import { DeliveryEventRepository } from '../../../packages/support-core/src/repositories/delivery-event-repository.ts';
import { MessageRepository } from '../../../packages/support-core/src/repositories/message-repository.ts';
import {
  InboundMessageConflictError,
  InboundMessageService,
} from '../../../packages/support-core/src/services/inbound-message-service.ts';
import { PostgresJobQueue } from '../../../packages/support-core/src/services/postgres-job-queue.ts';
import { createDbClient } from './create-db-client.ts';
import { createRealtimePublisher } from './create-realtime-publisher.ts';
import {
  isLocalMockWebhookAllowed,
  readWebhookProvider,
  requestHeadersToRecord,
  type WebhookAccountContext,
} from './webhook-credentials.ts';
import {
  getWebhookRuntimeConfig,
  jsonResponse,
  type WebhookRuntimeConfig,
} from './webhook-runtime.ts';

type ProviderWebhookAdapter = {
  verifyWebhook(input: {
    headers: Record<string, string>;
    body: string;
    signingSecret: string;
  }): Promise<boolean>;
};

type InboundWebhookAdapter<TNormalized> = ProviderWebhookAdapter & {
  parseInboundWebhook(body: unknown): TNormalized;
};

type StatusWebhookPayload = {
  externalMessageId: string;
  status: DeliveryStatus;
  errorCode?: string;
  errorMessage?: string;
  rawPayload: Record<string, unknown>;
};

type StatusWebhookAdapter = ProviderWebhookAdapter & {
  parseStatusWebhook(body: unknown): StatusWebhookPayload;
};

type InboundServiceBoundary = Pick<
  InboundMessageService,
  'processInboundSms' | 'processInboundEmail'
>;

type MessageStatusBoundary = Pick<
  MessageRepository,
  'findByExternalId' | 'updateDeliveryStatus'
>;

type DeliveryEventBoundary = Pick<DeliveryEventRepository, 'create'>;

type RealtimePublisherBoundary = {
  publish(channel: string, event: string, payload: unknown): Promise<void>;
};

export interface WebhookPipelineDependencies {
  getRuntimeConfig(): WebhookRuntimeConfig;
  createDatabase(baseUrl: string, serviceRoleKey: string): DatabaseClient;
  createInboundService(db: DatabaseClient): InboundServiceBoundary;
  createMessageRepository(db: DatabaseClient): MessageStatusBoundary;
  createDeliveryEventRepository(db: DatabaseClient): DeliveryEventBoundary;
  createRealtimePublisher(
    baseUrl: string,
    serviceRoleKey: string,
  ): RealtimePublisherBoundary;
}

const defaultDependencies: WebhookPipelineDependencies = {
  getRuntimeConfig: getWebhookRuntimeConfig,
  createDatabase: createDbClient,
  createInboundService(db) {
    return new InboundMessageService(
      new ContactRepository(db),
      new ConversationRepository(db),
      new MessageRepository(db),
      new PostgresJobQueue(db),
      new AuditLogRepository(db),
    );
  },
  createMessageRepository: (db) => new MessageRepository(db),
  createDeliveryEventRepository: (db) => new DeliveryEventRepository(db),
  createRealtimePublisher,
};

export interface InboundWebhookPipelineConfig<TNormalized> {
  channelLabel: 'SMS' | 'email';
  errorPrefix: 'sms-inbound' | 'email-inbound';
  createAdapter(provider: string): InboundWebhookAdapter<TNormalized>;
  parseBody(rawBody: string, provider: string): unknown;
  destination(normalized: TNormalized): string;
  resolveContext(
    db: DatabaseClient,
    provider: string,
    destination: string,
    baseUrl: string,
    serviceRoleKey: string,
  ): Promise<WebhookAccountContext | null>;
  processInbound(
    service: InboundServiceBoundary,
    normalized: TNormalized,
    organizationId: string,
    provider: string,
  ): Promise<Message>;
}

export interface StatusWebhookPipelineConfig {
  channel: 'sms' | 'email';
  channelLabel: 'SMS' | 'email';
  errorPrefix: 'sms-status' | 'email-status';
  createAdapter(provider: string): StatusWebhookAdapter;
  parseBody(rawBody: string, provider: string): unknown;
  resolveContext(
    db: DatabaseClient,
    provider: string,
    externalMessageId: string,
    baseUrl: string,
    serviceRoleKey: string,
  ): Promise<WebhookAccountContext | null>;
}

/** Build a provider-authenticated inbound-message webhook entrypoint. */
export function createInboundWebhookHandler<TNormalized>(
  config: InboundWebhookPipelineConfig<TNormalized>,
  dependencies: WebhookPipelineDependencies = defaultDependencies,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    try {
      const provider = readWebhookProvider(req.headers);
      if (!provider) {
        return jsonResponse({ error: 'x-provider header is required' }, 400);
      }

      const { baseUrl, localMockOptIn, serviceRoleKey } = dependencies.getRuntimeConfig();
      if (provider === 'mock' && !isLocalMockWebhookAllowed(req.url, baseUrl, localMockOptIn)) {
        return jsonResponse(
          { error: `Mock ${config.channelLabel} webhooks are disabled outside local development` },
          403,
        );
      }

      const rawBody = await req.text();
      let adapter: InboundWebhookAdapter<TNormalized>;
      try {
        adapter = config.createAdapter(provider);
      } catch {
        return jsonResponse({ error: `Unknown ${config.channelLabel} provider: ${provider}` }, 400);
      }

      let body: unknown;
      try {
        body = config.parseBody(rawBody, provider);
      } catch {
        return jsonResponse({ error: 'Invalid webhook body' }, 400);
      }

      let normalized: TNormalized;
      try {
        normalized = adapter.parseInboundWebhook(body);
      } catch (error) {
        return jsonResponse(
          {
            error: error instanceof Error
              ? error.message
              : `Invalid ${config.channelLabel} webhook payload`,
          },
          400,
        );
      }

      const db = dependencies.createDatabase(baseUrl, serviceRoleKey);
      const webhookContext = await config.resolveContext(
        db,
        provider,
        config.destination(normalized),
        baseUrl,
        serviceRoleKey,
      );
      if (!webhookContext) {
        return jsonResponse({ error: 'Webhook provider account not found' }, 401);
      }

      const isValid = await adapter.verifyWebhook({
        headers: requestHeadersToRecord(req.headers),
        body: rawBody,
        signingSecret: webhookContext.signingSecret,
      });
      if (!isValid) {
        return jsonResponse({ error: 'Webhook signature verification failed' }, 401);
      }

      const message = await config.processInbound(
        dependencies.createInboundService(db),
        normalized,
        webhookContext.organizationId,
        webhookContext.provider,
      );

      const realtimePublisher = dependencies.createRealtimePublisher(baseUrl, serviceRoleKey);
      await realtimePublisher.publish(
        `org:${webhookContext.organizationId}`,
        'new_message',
        { message, conversationId: message.conversationId },
      );

      return jsonResponse({ status: 'ok', data: message });
    } catch (error) {
      if (error instanceof InboundMessageConflictError) {
        return jsonResponse({ error: 'Inbound message conflict' }, 409);
      }
      console.error(`${config.errorPrefix} error:`, error);
      return jsonResponse(
        {
          error: 'Internal server error',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        500,
      );
    }
  };
}

/** Build a provider-authenticated delivery-status webhook entrypoint. */
export function createStatusWebhookHandler(
  config: StatusWebhookPipelineConfig,
  dependencies: WebhookPipelineDependencies = defaultDependencies,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    try {
      const provider = readWebhookProvider(req.headers);
      if (!provider) {
        return jsonResponse({ error: 'x-provider header is required' }, 400);
      }

      const { baseUrl, localMockOptIn, serviceRoleKey } = dependencies.getRuntimeConfig();
      if (provider === 'mock' && !isLocalMockWebhookAllowed(req.url, baseUrl, localMockOptIn)) {
        return jsonResponse(
          { error: `Mock ${config.channelLabel} status webhooks are disabled outside local development` },
          403,
        );
      }

      const rawBody = await req.text();
      let adapter: StatusWebhookAdapter;
      try {
        adapter = config.createAdapter(provider);
      } catch {
        return jsonResponse({ error: `Unknown ${config.channelLabel} provider: ${provider}` }, 400);
      }

      let body: unknown;
      try {
        body = config.parseBody(rawBody, provider);
      } catch {
        return jsonResponse({ error: 'Invalid webhook body' }, 400);
      }

      let normalizedStatus: StatusWebhookPayload;
      try {
        normalizedStatus = adapter.parseStatusWebhook(body);
      } catch (error) {
        return jsonResponse(
          {
            error: error instanceof Error
              ? error.message
              : `Invalid ${config.channelLabel} status webhook payload`,
          },
          400,
        );
      }

      const db = dependencies.createDatabase(baseUrl, serviceRoleKey);
      const webhookContext = await config.resolveContext(
        db,
        provider,
        normalizedStatus.externalMessageId,
        baseUrl,
        serviceRoleKey,
      );
      if (!webhookContext) {
        return jsonResponse({ error: 'Webhook provider account not found' }, 401);
      }

      const isValid = await adapter.verifyWebhook({
        headers: requestHeadersToRecord(req.headers),
        body: rawBody,
        signingSecret: webhookContext.signingSecret,
      });
      if (!isValid) {
        return jsonResponse({ error: 'Webhook signature verification failed' }, 401);
      }

      const messageRepository = dependencies.createMessageRepository(db);
      const message = await messageRepository.findByExternalId(
        provider,
        normalizedStatus.externalMessageId,
      );
      if (!message) {
        return jsonResponse({ status: 'ok', message: 'Message not found, status ignored' });
      }

      await dependencies.createDeliveryEventRepository(db).create(config.channel, {
        messageId: message.id,
        providerAccountId: message.providerAccountId,
        status: normalizedStatus.status,
        errorCode: normalizedStatus.errorCode ?? null,
        errorMessage: normalizedStatus.errorMessage ?? null,
        rawPayload: normalizedStatus.rawPayload,
      });
      const effectiveMessage = await messageRepository.updateDeliveryStatus(
        message.id,
        normalizedStatus.status,
      );

      return jsonResponse({
        status: 'ok',
        data: {
          messageId: message.id,
          deliveryStatus: effectiveMessage.deliveryStatus,
        },
      });
    } catch (error) {
      console.error(`${config.errorPrefix} error:`, error);
      return jsonResponse(
        {
          error: 'Internal server error',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        500,
      );
    }
  };
}
