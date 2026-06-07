/**
 * Live AI eval — runs the golden conversations against a real OpenRouter
 * model and writes a recording file the comparison harness can replay.
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-or-... npx tsx scripts/eval/run-eval-live.ts \
 *     --model openai/gpt-4o-mini --label live-gpt-4o-mini
 *
 *   # multiple models in one call:
 *   OPENROUTER_API_KEY=sk-or-... npx tsx scripts/eval/run-eval-live.ts \
 *     --models openai/gpt-4o-mini,anthropic/claude-3-haiku --out-dir eval-output/live
 *
 * Output:
 *   <out-dir>/recording-<label>.json  — LLM responses per fixture id
 *   <out-dir>/recording-<label>.log   — human-readable run log
 *
 * The recording file is the canonical artifact: it is replayed by
 * run-eval.ts / run-eval-compare.ts to produce the standard CSV + report.
 * This means a live run only needs to hit the API once; later, anyone
 * can rerun the comparison offline.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { AiAgentService } from '../../packages/support-core/src/services/ai-agent-service.js';
import { EscalationEngine } from '../../packages/support-core/src/interfaces/escalation.js';
import {
  HumanRequestRule,
  ProfanityAngerRule,
  SensitiveTopicRule,
  SafetyConcernRule,
  MissingKnowledgeRule,
  LowConfidenceRule,
  RepeatedFailureRule,
  KeywordRule,
} from '../../packages/support-core/src/services/escalation-rules.js';
import type { AiClient } from '../../packages/support-core/src/interfaces/ai-client.js';
import type {
  ChatCompletionParams,
  ChatCompletionResult,
  EmbeddingParams,
} from '../../packages/support-core/src/types/index.js';

import { GOLDEN_CONVERSATIONS } from '../../packages/support-core/__tests__/golden/index.js';
import type { GoldenConversation } from '../../packages/support-core/__tests__/golden/types.js';
import type { Message } from '../../packages/support-core/src/types/index.js';
import type { ConversationRepository } from '../../packages/support-core/src/repositories/conversation-repository.js';
import type { MessageRepository } from '../../packages/support-core/src/repositories/message-repository.js';
import type { KnowledgeRepository } from '../../packages/support-core/src/repositories/knowledge-repository.js';
import type { AiSettingsRepository } from '../../packages/support-core/src/repositories/ai-settings-repository.js';
import type { AiDecisionRepository } from '../../packages/support-core/src/repositories/ai-decision-repository.js';
import type { AuditLogRepository } from '../../packages/support-core/src/repositories/audit-log-repository.js';
import type { JobQueue } from '../../packages/support-core/src/interfaces/job-queue.js';
import type {
  Conversation,
  AiSettings,
  AiDecision,
  KnowledgeChunk,
  CreateConversationInput,
  CreateMessageInput,
  CreateAiSettingsInput,
  CreateAiDecisionInput,
  CreateAuditLogInput,
  Channel,
  ConversationStatus,
  AiState,
} from '../../packages/support-core/src/types/index.js';

import { OpenRouterAiClient } from './openrouter-ai-client.js';
import type { Recording } from './mock-ai-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'eval-output', 'live');

interface CliArgs {
  models: string[];
  labels: string[];
  concurrency: number;
  outDir: string;
  includeJudge: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    models: [],
    labels: [],
    concurrency: 2,
    outDir: DEFAULT_OUT_DIR,
    includeJudge: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model' && argv[i + 1]) {
      args.models.push(argv[++i]!);
    } else if (a === '--models' && argv[i + 1]) {
      args.models = argv[++i]!.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a === '--label' && argv[i + 1]) {
      args.labels.push(argv[++i]!);
    } else if (a === '--concurrency' && argv[i + 1]) {
      args.concurrency = parseInt(argv[++i]!, 10);
    } else if (a === '--out-dir' && argv[i + 1]) {
      args.outDir = argv[++i]!;
    } else if (a === '--include-judge') {
      args.includeJudge = true;
    }
  }
  if (args.labels.length === 0) {
    args.labels = args.models.map((m) => `live-${m.replace(/[^a-zA-Z0-9]+/g, '-')}`);
  } else if (args.labels.length !== args.models.length) {
    throw new Error(`--label count (${args.labels.length}) must match --models count (${args.models.length})`);
  }
  return args;
}

// ─── Recording AiClient ─────────────────────────────────────────────

/**
 * Wraps an underlying AiClient and records every chat-completion call.
 * The recording is keyed by the [EVAL_GC:<id>] marker the harness injects
 * into the system prompt.
 */
class RecordingAiClient implements AiClient {
  private readonly inner: AiClient;
  private readonly model: string;
  private readonly recording: Recording = {};
  public readonly log: Array<{ fixtureId: string; content: string; ms: number; error?: string }> = [];

  constructor(inner: AiClient, model: string) {
    this.inner = inner;
    this.model = model;
  }

  getRecording(): Recording {
    return this.recording;
  }

  async chatCompletion(params: ChatCompletionParams): Promise<ChatCompletionResult> {
    const gcId = extractGcId(params);
    const t0 = Date.now();
    try {
      // Force the requested model on every call.
      const result = await this.inner.chatCompletion({ ...params, model: this.model });
      this.recording[gcId] = result.content;
      this.log.push({ fixtureId: gcId, content: result.content, ms: Date.now() - t0 });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.recording[gcId] = { throw: msg };
      this.log.push({ fixtureId: gcId, content: '', ms: Date.now() - t0, error: msg });
      throw err;
    }
  }

  async createEmbedding(params: EmbeddingParams): Promise<number[]> {
    return this.inner.createEmbedding(params);
  }
}

function extractGcId(params: ChatCompletionParams): string {
  for (const m of params.messages) {
    if (m.role === 'system' || m.role === 'user') {
      const match = /\[EVAL_GC:([a-zA-Z0-9_-]+)\]/.exec(m.content);
      if (match) return match[1]!;
    }
  }
  throw new Error('No [EVAL_GC:<id>] marker in messages — fixture does not have one.');
}

// ─── In-memory repos (same shape as run-eval.ts) ────────────────────

function makeConversationRepo(): ConversationRepository {
  const conv: Conversation = {
    id: '',
    organizationId: '',
    contactId: '',
    channel: 'sms' as Channel,
    status: 'open' as ConversationStatus,
    aiState: 'idle' as AiState,
    subject: null,
    assignedTo: null,
    lastMessageAt: null,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return {
    findById: async (id: string) => ({ ...conv, id }),
    findOpenByContactAndChannel: async () => null,
    create: async (input: CreateConversationInput) => ({ ...conv, ...input } as Conversation),
    update: async (id: string, patch: Partial<Conversation>) => ({ ...conv, id, ...patch } as Conversation),
    listByOrg: async () => [],
  } as unknown as ConversationRepository;
}

function makeMessageRepo(seedMsgsByConv: Map<string, Message[]>): MessageRepository {
  return {
    findByExternalId: async () => null,
    create: async (input: CreateMessageInput) => input as Message,
    listByConversation: async (conversationId: string) => seedMsgsByConv.get(conversationId) ?? [],
  } as unknown as MessageRepository;
}

function makeKnowledgeRepo(chunks: KnowledgeChunk[]): KnowledgeRepository {
  return {
    matchChunks: async () => chunks,
    getDocument: async () => null,
    createDocument: async () => ({} as any),
    updateDocument: async () => ({} as any),
    deleteDocumentWithChunks: async () => undefined,
    insertChunks: async () => undefined,
    deleteChunksByDocument: async () => undefined,
  } as unknown as KnowledgeRepository;
}

function makeAiSettingsRepo(initial: AiSettings): AiSettingsRepository {
  const store: AiSettings[] = [initial];
  return {
    findByOrg: async (orgId: string) => store.find((s) => s.organizationId === orgId) ?? null,
    create: async (input: CreateAiSettingsInput) => {
      const created: AiSettings = { ...input, id: `settings-${store.length + 1}`, createdAt: new Date(), updatedAt: new Date() } as AiSettings;
      store.push(created);
      return created;
    },
    update: async (orgId: string, patch: Partial<AiSettings>) => {
      const existing = store.find((s) => s.organizationId === orgId);
      if (!existing) throw new Error('no settings');
      Object.assign(existing, patch, { updatedAt: new Date() });
      return existing;
    },
  } as unknown as AiSettingsRepo;
}

// Type alias to fix the unused-import linter complaint.
type AiSettingsRepo = AiSettingsRepository;

function makeAiDecisionRepo(): AiDecisionRepository {
  const decisions: AiDecision[] = [];
  let counter = 0;
  return {
    create: async (input: CreateAiDecisionInput) => {
      counter++;
      const d: AiDecision = { ...input, id: `dec-${counter}`, createdAt: new Date() } as AiDecision;
      decisions.push(d);
      return d;
    },
    findLatestByConversation: async (conversationId: string) =>
      decisions.filter((d) => d.conversationId === conversationId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null,
  } as unknown as AiDecisionRepository;
}

function makeAuditLogRepo(): AuditLogRepository {
  return {
    create: async (input: CreateAuditLogInput) => ({ ...input, id: `audit-${Date.now()}`, createdAt: new Date() } as any),
  } as unknown as AuditLogRepository;
}

function makeJobQueue(): JobQueue {
  return {
    enqueue: async () => ({ id: 'job-1', organizationId: '', jobType: 'send_outbound_message' as any, payload: {} as any, status: 'pending' as const, attempts: 0, maxAttempts: 5, lastError: null, runAfter: new Date(), createdAt: new Date(), updatedAt: new Date(), completedAt: null }),
    claim: async () => [],
    complete: async () => undefined,
    fail: async () => undefined,
  } as unknown as JobQueue;
}

function seedMessages(fixture: GoldenConversation): Message[] {
  return fixture.messages.map((m, i) => ({
    id: `${fixture.id}-msg-${i + 1}`,
    conversationId: fixture.id,
    senderType: m.senderType,
    senderId: m.senderType === 'contact' ? `contact-${fixture.id}` : null,
    direction: m.senderType === 'contact' ? 'inbound' : 'outbound',
    channel: m.channel,
    body: m.body,
    subject: m.subject ?? null,
    rawPayload: {},
    provider: m.senderType === 'contact' ? 'mock' : null,
    providerAccountId: null,
    externalMessageId: m.externalMessageId ?? null,
    deliveryStatus: m.senderType === 'contact' ? 'delivered' : 'sent',
    createdAt: new Date(m.createdAt ?? '2026-06-07T11:55:00Z'),
    updatedAt: new Date(m.createdAt ?? '2026-06-07T11:55:00Z'),
  }));
}

function seedKnowledgeChunks(fixture: GoldenConversation): KnowledgeChunk[] {
  return (fixture.knowledgeChunks ?? []).map((c) => ({
    id: c.id,
    documentId: c.id,
    organizationId: `org-${fixture.id}`,
    content: c.content,
    embedding: [],
    metadata: {},
    createdAt: new Date(),
  }));
}

function buildAiSettings(fixture: GoldenConversation, model: string): AiSettings {
  return {
    id: `settings-${fixture.id}`,
    organizationId: `org-${fixture.id}`,
    aiMode: fixture.aiMode,
    confidenceThreshold: fixture.confidenceThreshold,
    contextWindowSize: 20,
    maxConsecutiveFailures: 3,
    knowledgeSimilarityThreshold: 0.7,
    escalationKeywords: [],
    systemPrompt: `[EVAL_GC:${fixture.id}] You are a helpful support agent. Always produce JSON in the documented shape.`,
    model,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ─── Per-model run ──────────────────────────────────────────────────

async function runModel(
  model: string,
  label: string,
  outDir: string,
  apiKey: string,
): Promise<Recording> {
  const client = new OpenRouterAiClient({ apiKey, defaultModel: model, timeoutMs: 60_000 });
  const recorder = new RecordingAiClient(client, model);
  const engine = new EscalationEngine();
  engine.register(new HumanRequestRule());
  engine.register(new ProfanityAngerRule());
  engine.register(new SensitiveTopicRule());
  engine.register(new SafetyConcernRule());
  engine.register(new MissingKnowledgeRule());
  engine.register(new LowConfidenceRule());
  engine.register(new RepeatedFailureRule());
  engine.register(new KeywordRule());

  fs.mkdirSync(outDir, { recursive: true });
  const logPath = path.join(outDir, `recording-${label}.log`);
  const logStream = fs.createWriteStream(logPath, { flags: 'w' });
  const log = (msg: string) => {
    console.log(msg);
    logStream.write(msg + '\n');
  };

  log(`# Live eval: ${label} (${model})`);
  log(`# fixtures: ${GOLDEN_CONVERSATIONS.length}`);

  let ok = 0;
  let fail = 0;
  for (const fixture of GOLDEN_CONVERSATIONS) {
    const seedMsgs = seedMessages(fixture);
    const seedMsgsByConv = new Map<string, Message[]>();
    seedMsgsByConv.set(fixture.id, seedMsgs);
    const settings = buildAiSettings(fixture, model);

    const service = new AiAgentService(
      makeConversationRepo(),
      makeMessageRepo(seedMsgsByConv),
      makeKnowledgeRepo(seedKnowledgeChunks(fixture)),
      makeAiSettingsRepo(settings),
      makeAiDecisionRepo(),
      engine,
      recorder,
      makeJobQueue(),
      makeAuditLogRepo(),
    );

    const t0 = Date.now();
    let result: AiDecision | null = null;
    let err: Error | null = null;
    try {
      // Force the requested model on every call.
      result = await service.processMessage(fixture.id, settings.organizationId);
    } catch (e) {
      err = e instanceof Error ? e : new Error(String(e));
    }
    const ms = Date.now() - t0;
    if (err) {
      const msg = err.message;
      this.recording[gcId] = { throw: msg };
      this.log.push({ fixtureId: gcId, content: '', ms, error: msg });
      log(`ERR ${fixture.id}  threw: ${msg.slice(0, 200)}`);
      fail++;
    } else if (result) {
      log(`DONE ${fixture.id}  decision=${result.decisionType}  conf=${result.confidence.toFixed(2)}  (${ms}ms)`);
      ok++;
    }
  }

  logStream.end();
  log(`# done. ok=${ok} fail=${fail}`);

  const rec = recorder.getRecording();
  const recPath = path.join(outDir, `recording-${label}.json`);
  fs.writeFileSync(recPath, JSON.stringify(rec, null, 2), 'utf8');
  log(`# recording: ${recPath}`);
  return rec;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.models.length === 0) {
    console.error('usage: run-eval-live.ts --models <m1,m2,...> [--label <l1,l2,...>] [--out-dir dir] [--concurrency N]');
    process.exit(2);
  }
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('OPENROUTER_API_KEY is required for live runs.');
    process.exit(2);
  }
  fs.mkdirSync(args.outDir, { recursive: true });

  for (let i = 0; i < args.models.length; i++) {
    const model = args.models[i]!;
    const label = args.labels[i]!;
    console.log(`\n=== ${label} (${model}) ===`);
    await runModel(model, label, args.outDir, apiKey);
  }
}

const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
