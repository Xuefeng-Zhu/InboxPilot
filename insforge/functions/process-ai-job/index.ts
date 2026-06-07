/**
 * process-ai-job — Processes an AI message job from the queue.
 *
 * Auth: Internal (job queue — no JWT required)
 * Trigger: Called by process-jobs when a process_ai_message job is claimed
 *
 * Flow:
 * 1. Parse request body for conversationId and orgId
 * 2. Create dependencies (DB client, repos, services)
 * 3. Delegate to AiAgentService.processMessage
 * 4. Publish conversation_updated realtime event
 * 5. Return result
 */

import { createDbClient } from '../_shared/create-db-client.js';
import { createRealtimePublisher } from '../_shared/create-realtime-publisher.js';
import { requireInternalToken } from '../_shared/require-internal-token.js';
import { ConversationRepository } from '../../../packages/support-core/src/repositories/conversation-repository.js';
import { MessageRepository } from '../../../packages/support-core/src/repositories/message-repository.js';
import { KnowledgeRepository } from '../../../packages/support-core/src/repositories/knowledge-repository.js';
import { AiSettingsRepository } from '../../../packages/support-core/src/repositories/ai-settings-repository.js';
import { AiDecisionRepository } from '../../../packages/support-core/src/repositories/ai-decision-repository.js';
import { AuditLogRepository } from '../../../packages/support-core/src/repositories/audit-log-repository.js';
import { PostgresJobQueue } from '../../../packages/support-core/src/services/postgres-job-queue.js';
import { AiAgentService } from '../../../packages/support-core/src/services/ai-agent-service.js';
import { createDefaultEscalationEngine } from '../../../packages/support-core/src/services/escalation-rules.js';
import type { AiClient } from '../../../packages/support-core/src/interfaces/ai-client.js';
import type {
  ChatCompletionParams,
  ChatCompletionResult,
  EmbeddingParams,
} from '../../../packages/support-core/src/types/index.js';

/**
 * Create an AiClient that delegates to the InsForge AI Gateway (OpenRouter).
 */
function createAiClient(baseUrl: string, serviceRoleKey: string): AiClient {
  return {
    async chatCompletion(params: ChatCompletionParams): Promise<ChatCompletionResult> {
      const res = await fetch(`${baseUrl}/ai/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          model: params.model,
          messages: params.messages,
          response_format: params.responseFormat,
          temperature: params.temperature,
        }),
      });

      if (!res.ok) {
        const errorBody = await res.text().catch(() => 'unknown error');
        throw new Error(`AI chat completion failed: HTTP ${res.status} — ${errorBody}`);
      }

      const data = (await res.json()) as Record<string, unknown>;
      const choices = data.choices as Array<{ message: { content: string } }>;
      const content = choices?.[0]?.message?.content ?? '';
      const usage = data.usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;

      return {
        content,
        usage: usage
          ? {
              promptTokens: usage.prompt_tokens ?? 0,
              completionTokens: usage.completion_tokens ?? 0,
              totalTokens: usage.total_tokens ?? 0,
            }
          : undefined,
      };
    },

    async createEmbedding(params: EmbeddingParams): Promise<number[]> {
      const res = await fetch(`${baseUrl}/ai/v1/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          model: params.model,
          input: params.input,
        }),
      });

      if (!res.ok) {
        const errorBody = await res.text().catch(() => 'unknown error');
        throw new Error(`AI embedding failed: HTTP ${res.status} — ${errorBody}`);
      }

      const data = (await res.json()) as Record<string, unknown>;
      const embeddings = data.data as Array<{ embedding: number[] }>;
      return embeddings?.[0]?.embedding ?? [];
    },
  };
}

export default async function (req: Request): Promise<Response> {
  try {
    // 0. Internal-dispatch auth (CRITICAL-4). The function URL is public,
    //    so anyone who guesses it could force AI analysis of any
    //    conversation (cost amplification). Require the shared secret in
    //    `x-internal-token`, compared against the server-side
    //    `INTERNAL_DISPATCH_TOKEN` env var.
    const envToken = (globalThis as Record<string, unknown>).Deno
      ? (globalThis as Record<string, { get(key: string): string | undefined }>).Deno.env.get('INTERNAL_DISPATCH_TOKEN')
      : process.env.INTERNAL_DISPATCH_TOKEN;
    const authResult = requireInternalToken(req, envToken ?? undefined);
    if (authResult.kind === 'misconfigured') {
      return new Response(
        JSON.stringify({ error: 'Internal dispatch token is not configured on the server' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (authResult.kind === 'unauthorized') {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // 1. Parse request body
    const body = (await req.json()) as Record<string, unknown>;
    const conversationId = body.conversation_id as string;
    const orgId = body.organization_id as string;

    if (!conversationId || !orgId) {
      return new Response(
        JSON.stringify({ error: 'Missing conversation_id or organization_id' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // 2. Create dependencies
    const baseUrl = (globalThis as Record<string, unknown>).Deno
      ? (globalThis as Record<string, { get(key: string): string | undefined }>).Deno.env.get('INSFORGE_BASE_URL')
      : process.env.INSFORGE_BASE_URL;
    const serviceRoleKey = (globalThis as Record<string, unknown>).Deno
      ? (globalThis as Record<string, { get(key: string): string | undefined }>).Deno.env.get('INSFORGE_SERVICE_ROLE_KEY')
      : process.env.INSFORGE_SERVICE_ROLE_KEY;

    if (!baseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: 'Missing environment configuration' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const db = createDbClient(baseUrl, serviceRoleKey);
    const realtime = createRealtimePublisher(baseUrl, serviceRoleKey);

    const conversationRepo = new ConversationRepository(db);
    const messageRepo = new MessageRepository(db);
    const knowledgeRepo = new KnowledgeRepository(db);
    const aiSettingsRepo = new AiSettingsRepository(db);
    const aiDecisionRepo = new AiDecisionRepository(db);
    const auditLogRepo = new AuditLogRepository(db);
    const jobQueue = new PostgresJobQueue(db);
    const aiClient = createAiClient(baseUrl, serviceRoleKey);
    const escalationEngine = createDefaultEscalationEngine();

    const aiAgentService = new AiAgentService(
      conversationRepo,
      messageRepo,
      knowledgeRepo,
      aiSettingsRepo,
      aiDecisionRepo,
      escalationEngine,
      aiClient,
      jobQueue,
      auditLogRepo,
    );

    // 3. Delegate to AiAgentService
    const decision = await aiAgentService.processMessage(conversationId, orgId);

    // 4. Publish realtime event
    await realtime.publish(`org:${orgId}`, 'conversation_updated', {
      conversationId,
      aiDecisionId: decision.id,
      decisionType: decision.decisionType,
    });

    // 5. Return result
    return new Response(
      JSON.stringify({
        status: 'ok',
        decision: {
          id: decision.id,
          decisionType: decision.decisionType,
          confidence: decision.confidence,
          requiresHuman: decision.requiresHuman,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
