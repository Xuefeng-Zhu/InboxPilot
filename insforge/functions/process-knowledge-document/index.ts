/**
 * process-knowledge-document — Processes a knowledge document ingestion job.
 *
 * Auth: Internal (job queue)
 * Trigger: Job queue with payload { documentId }
 * Delegates to: KnowledgeIngestionService.processDocument
 *
 * Flow:
 * 1. Parse request body as JSON — expect { documentId }
 * 2. Create database client, repositories, AI client, and KnowledgeIngestionService
 * 3. Delegate to processDocument(documentId)
 * 4. Publish knowledge_document_updated realtime event on status change
 * 5. Return 200 OK
 *
 * Requirements: 16.1, 16.2, 16.3
 */

import { createDbClient } from '../_shared/create-db-client.js';
import { createRealtimePublisher } from '../_shared/create-realtime-publisher.js';
import { logError, newRequestContext, withRequest, withRequestIdHeader } from '../_shared/logger.js';
import { requireInternalToken } from '../_shared/require-internal-token.js';

import { KnowledgeRepository } from '../../../packages/support-core/src/repositories/knowledge-repository.js';
import { AuditLogRepository } from '../../../packages/support-core/src/repositories/audit-log-repository.js';
import { KnowledgeIngestionService } from '../../../packages/support-core/src/services/knowledge-ingestion-service.js';
import type { AiClient } from '../../../packages/support-core/src/interfaces/ai-client.js';

// ---------------------------------------------------------------------------
// Helper: JSON response builder
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Helper: Create an AiClient backed by the InsForge AI gateway
// ---------------------------------------------------------------------------

function createAiClient(baseUrl: string, serviceRoleKey: string): AiClient {
  return {
    async chatCompletion(params) {
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
          ...(params.responseFormat ? { response_format: params.responseFormat } : {}),
          ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
        }),
      });

      if (!res.ok) {
        const errorBody = await res.text().catch(() => 'unknown error');
        throw new Error(`AI chat completion failed: HTTP ${res.status} — ${errorBody}`);
      }

      const json = (await res.json()) as {
        choices: Array<{ message: { content: string } }>;
        usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      };

      return {
        content: json.choices[0]?.message?.content ?? '',
        usage: json.usage
          ? {
              promptTokens: json.usage.prompt_tokens,
              completionTokens: json.usage.completion_tokens,
              totalTokens: json.usage.total_tokens,
            }
          : undefined,
      };
    },

    async createEmbedding(params) {
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

      const json = (await res.json()) as {
        data: Array<{ embedding: number[] }>;
      };

      return json.data[0]?.embedding ?? [];
    },
  };
}

// ---------------------------------------------------------------------------
// Function entrypoint
// ---------------------------------------------------------------------------

export default async function (req: Request): Promise<Response> {
  // Internal-dispatch entrypoint. org_id is learned after the
  // document is loaded (it is not in the request body), so it
  // gets set inside the body.
  const ctx = newRequestContext('process-knowledge-document', req);
  return withRequest(ctx, async () => {
    try {
      // 0. Internal-dispatch auth (CRITICAL-4). The function URL is public,
      //    so anyone who guesses it could trigger re-embedding of any
      //    document (cost amplification + KB drift). Require the shared
      //    secret in `x-internal-token`, compared against the server-side
      //    `INTERNAL_DISPATCH_TOKEN` env var.
      const envToken = (typeof Deno !== 'undefined' ? Deno.env.get('INTERNAL_DISPATCH_TOKEN') : undefined) ??
        process.env.INTERNAL_DISPATCH_TOKEN;
      const authResult = requireInternalToken(req, envToken);
      if (authResult.kind === 'misconfigured') {
        // Server-side misconfiguration: env var not set. 500 so an
        // operator notices and rotates the secret.
        return jsonResponse(
          { error: 'Internal dispatch token is not configured on the server' },
          500,
        );
      }
      if (authResult.kind === 'unauthorized') {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      // 1. Parse request body
      let payload: { documentId?: string };
      try {
        payload = await req.json();
      } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400);
      }

      const { documentId } = payload;

      if (!documentId || typeof documentId !== 'string') {
        return jsonResponse({ error: 'Missing or invalid documentId' }, 400);
      }

      // 2. Create dependencies
      const baseUrl =
        (typeof Deno !== 'undefined' ? Deno.env.get('INSFORGE_BASE_URL') : undefined) ??
        process.env.NEXT_PUBLIC_INSFORGE_URL ??
        '';
      const serviceRoleKey =
        (typeof Deno !== 'undefined' ? Deno.env.get('INSFORGE_SERVICE_ROLE_KEY') : undefined) ??
        process.env.INSFORGE_SERVICE_ROLE_KEY ??
        '';

      const db = createDbClient(baseUrl, serviceRoleKey);
      const knowledgeRepo = new KnowledgeRepository(db);
      const auditLogRepo = new AuditLogRepository(db);
      const aiClient = createAiClient(baseUrl, serviceRoleKey);

      const ingestionService = new KnowledgeIngestionService(
        knowledgeRepo,
        aiClient,
        auditLogRepo,
      );

      // Load the document to get the orgId for realtime publishing
      const document = await knowledgeRepo.getDocument(documentId);
      const orgId = document?.organizationId;
      if (orgId) ctx.org_id = orgId;

      // 3. Delegate to processDocument
      await ingestionService.processDocument(documentId);

      // 4. Publish knowledge_document_updated realtime event
      if (orgId) {
        const realtimePublisher = createRealtimePublisher(baseUrl, serviceRoleKey);
        await realtimePublisher.publish(`org:${orgId}`, 'knowledge_document_updated', {
          documentId,
          status: 'ready',
        });
      }

      // 5. Return 200 OK
      return jsonResponse({ status: 'ok', documentId });
    } catch (err) {
      logError(ctx, err, { msg: 'process-knowledge-document caught exception' });

      // Try to publish failure status via realtime. The realtime
      // publish is best-effort: if it throws we swallow the error
      // (we are already in the error path).
      try {
        const baseUrl =
          (typeof Deno !== 'undefined' ? Deno.env.get('INSFORGE_BASE_URL') : undefined) ??
          process.env.NEXT_PUBLIC_INSFORGE_URL ??
          '';
        const serviceRoleKey =
          (typeof Deno !== 'undefined' ? Deno.env.get('INSFORGE_SERVICE_ROLE_KEY') : undefined) ??
          process.env.INSFORGE_SERVICE_ROLE_KEY ??
          '';

        // We can't reliably get the orgId here since the error may have
        // occurred before loading the document. The audit log in the
        // service handles this.
        void baseUrl;
        void serviceRoleKey;
      } catch {
        // Ignore realtime publish errors in error handler
      }

      return jsonResponse(
        {
          error: 'Internal server error',
          message: err instanceof Error ? err.message : 'Unknown error',
        },
        500,
      );
    }
  }).then((res) => withRequestIdHeader(ctx, res));
}
