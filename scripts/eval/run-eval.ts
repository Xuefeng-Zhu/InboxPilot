/**
 * AI evaluation harness — runs the full set of golden conversations
 * through `AiAgentService` and scores the decisions and rubric text.
 *
 * Output:
 *   - eval-output/results-<model>-<timestamp>.csv
 *   - eval-output/summary-<model>-<timestamp>.json
 *   - eval-output/summary-<model>-<timestamp>.md  (Markdown report)
 *
 * Usage (from repo root):
 *   npx tsx scripts/eval/run-eval.ts                    # default: mock, gpt-4o-mini label
 *   npx tsx scripts/eval/run-eval.ts --label mock-gpt   # custom label
 *   npx tsx scripts/eval/run-eval.ts --recording foo.json
 *
 * The harness defaults to the MockAiClient (no network). To run a real
 * model, see run-eval-live.ts which wraps this with OpenRouterAiClient.
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
import type { ConversationRepository } from '../../packages/support-core/src/repositories/conversation-repository.js';
import type { MessageRepository } from '../../packages/support-core/src/repositories/message-repository.js';
import type { KnowledgeRepository } from '../../packages/support-core/src/repositories/knowledge-repository.js';
import type { AiSettingsRepository } from '../../packages/support-core/src/repositories/ai-settings-repository.js';
import type { AiDecisionRepository } from '../../packages/support-core/src/repositories/ai-decision-repository.js';
import type { AuditLogRepository } from '../../packages/support-core/src/repositories/audit-log-repository.js';
import type { JobQueue } from '../../packages/support-core/src/interfaces/job-queue.js';

import type {
  Conversation,
  Message,
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

import { GOLDEN_CONVERSATIONS } from '../../packages/support-core/__tests__/golden/index.js';
import type { GoldenConversation } from '../../packages/support-core/__tests__/golden/types.js';

import { MockAiClient, DEFAULT_RECORDING, type Recording } from './mock-ai-client.js';
import { HeuristicRubricJudge, type RubricJudge } from './rubric-judge.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_DIR = path.join(REPO_ROOT, 'eval-output');

// ─── In-memory repository implementations ──────────────────────────

function makeConversationRepo(seedMessagesByConv: Map<string, Message[]>): ConversationRepository {
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
    createdAt: new Date('2026-06-07T11:00:00Z'),
    updatedAt: new Date('2026-06-07T11:00:00Z'),
  };
  return {
    findById: async (id: string) => ({ ...conv, id }),
    findOpenByContactAndChannel: async () => null,
    create: async (input: CreateConversationInput) => ({ ...conv, ...input } as Conversation),
    update: async (id: string, patch: Partial<Conversation>) => ({ ...conv, id, ...patch } as Conversation),
    listByOrg: async () => [],
  } as unknown as ConversationRepository;
}

function makeMessageRepo(seedMessagesByConv: Map<string, Message[]>): MessageRepository {
  return {
    findByExternalId: async () => null,
    create: async (input: CreateMessageInput) => input as Message,
    listByConversation: async (conversationId: string) =>
      seedMessagesByConv.get(conversationId) ?? [],
  } as unknown as MessageRepository;
}

function makeKnowledgeRepo(
  chunksForThisConv: KnowledgeChunk[],
): KnowledgeRepository {
  // The harness always returns the fixture's chunks (we don't simulate
  // similarity scoring — fixtures that need no knowledge supply an empty array).
  return {
    matchChunks: async (_embedding: number[], _orgId: string, _limit: number) =>
      chunksForThisConv,
    getDocument: async () => null,
    createDocument: async () => ({} as any),
    updateDocument: async () => ({} as any),
    deleteDocumentWithChunks: async () => undefined,
    insertChunks: async () => undefined,
    deleteChunksByDocument: async () => undefined,
  } as unknown as KnowledgeRepository;
}

function makeAiSettingsRepo(): AiSettingsRepository {
  const store: AiSettings[] = [];
  return {
    findByOrg: async (orgId: string) => store.find((s) => s.organizationId === orgId) ?? null,
    create: async (input: CreateAiSettingsInput) => {
      const created: AiSettings = {
        ...input,
        id: `settings-${store.length + 1}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as AiSettings;
      store.push(created);
      return created;
    },
    update: async (orgId: string, patch: Partial<AiSettings>) => {
      const existing = store.find((s) => s.organizationId === orgId);
      if (!existing) throw new Error('no settings');
      Object.assign(existing, patch, { updatedAt: new Date() });
      return existing;
    },
  } as unknown as AiSettingsRepository;
}

function makeAiDecisionRepo(): AiDecisionRepository & { all: () => AiDecision[] } {
  const decisions: AiDecision[] = [];
  let counter = 0;
  return {
    create: async (input: CreateAiDecisionInput) => {
      counter++;
      const decision: AiDecision = {
        ...input,
        id: `dec-${counter}`,
        createdAt: new Date(),
      } as AiDecision;
      decisions.push(decision);
      return decision;
    },
    findLatestByConversation: async (conversationId: string) =>
      decisions
        .filter((d) => d.conversationId === conversationId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null,
    all: () => decisions.slice(),
  } as unknown as AiDecisionRepository & { all: () => AiDecision[] };
}

function makeAuditLogRepo(): AuditLogRepository {
  return {
    create: async (input: CreateAuditLogInput) => ({ ...input, id: `audit-${Date.now()}`, createdAt: new Date() } as any),
  } as unknown as AuditLogRepository;
}

function makeJobQueue(): JobQueue & { enqueued: Array<{ jobType: string; payload: Record<string, unknown>; orgId: string }> } {
  const enqueued: Array<{ jobType: string; payload: Record<string, unknown>; orgId: string }> = [];
  return {
    enqueue: async (jobType: string, payload: Record<string, unknown>, orgId: string) => {
      enqueued.push({ jobType, payload, orgId });
      return { id: `job-${enqueued.length}`, organizationId: orgId, jobType: payload as any, payload: payload as any, status: 'pending' as const, attempts: 0, maxAttempts: 5, lastError: null, runAfter: new Date(), createdAt: new Date(), updatedAt: new Date(), completedAt: null };
    },
    claim: async () => [],
    complete: async () => undefined,
    fail: async () => undefined,
    enqueued,
  } as unknown as JobQueue & { enqueued: Array<{ jobType: string; payload: Record<string, unknown>; orgId: string }> };
}

// ─── Fixture → seed messages ───────────────────────────────────────

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

function buildAiSettings(fixture: GoldenConversation): AiSettings {
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
    model: 'openai/gpt-4o-mini',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ─── Per-fixture scoring ───────────────────────────────────────────

interface FixtureScore {
  fixtureId: string;
  label: string;
  expectedDecision: string;
  actualDecision: string;
  decisionMatch: boolean;
  expectedRule: string | null;
  actualRule: string | null;
  expectedRequiresHuman: boolean;
  actualRequiresHuman: boolean;
  expectedOutboundEnqueued: boolean | null;
  actualOutboundEnqueued: boolean;
  confidence: number;
  minConfidence: number;
  confidencePass: boolean;
  responseText: string;
  rubricPass: boolean;
  rubricMean: number;
  rubricScores: Array<{ id: string; score: number; note: string }>;
  tags: string[];
  // Special non-rubric assertions resolved by the harness:
  decisionShapeChecks: Array<{ id: string; pass: boolean; note: string }>;
}

async function runFixture(
  fixture: GoldenConversation,
  aiClient: MockAiClient,
  judge: RubricJudge,
): Promise<FixtureScore> {
  const seedMsgs = seedMessages(fixture);
  const seedMsgsByConv = new Map<string, Message[]>();
  seedMsgsByConv.set(fixture.id, seedMsgs);

  const conversationRepo = makeConversationRepo(seedMsgsByConv);
  const messageRepo = makeMessageRepo(seedMsgsByConv);
  const knowledgeRepo = makeKnowledgeRepo(seedKnowledgeChunks(fixture));
  const aiSettingsRepo = makeAiSettingsRepo();
  const aiDecisionRepo = makeAiDecisionRepo();
  const auditLog = makeAuditLogRepo();
  const jobQueue = makeJobQueue();
  const settings = buildAiSettings(fixture);

  // Seed the settings repo with this fixture's settings.
  await aiSettingsRepo.create(settings);

  const engine = new EscalationEngine();
  engine.register(new HumanRequestRule());
  engine.register(new ProfanityAngerRule());
  engine.register(new SensitiveTopicRule());
  engine.register(new SafetyConcernRule());
  engine.register(new MissingKnowledgeRule());
  engine.register(new LowConfidenceRule());
  engine.register(new RepeatedFailureRule());
  engine.register(new KeywordRule());

  const service = new AiAgentService(
    conversationRepo,
    messageRepo,
    knowledgeRepo,
    aiSettingsRepo,
    aiDecisionRepo,
    engine,
    aiClient,
    jobQueue,
    auditLog,
  );

  let decision: AiDecision;
  try {
    decision = await service.processMessage(fixture.id, settings.organizationId);
  } catch (err) {
    decision = {
      id: 'dec-error',
      conversationId: fixture.id,
      organizationId: settings.organizationId,
      messageId: null,
      decisionType: 'respond',
      confidence: 0,
      reasoningSummary: `processMessage threw: ${err instanceof Error ? err.message : String(err)}`,
      responseText: null,
      tags: ['error'],
      requiresHuman: false,
      rawResponse: { error: String(err) },
      createdAt: new Date(),
    };
  }

  const actualDecision = decision.decisionType;
  const decisionMatch = actualDecision === fixture.expected.decision;
  const actualRequiresHuman = decision.requiresHuman;
  const actualOutboundEnqueued = jobQueue.enqueued.some(
    (e) => e.jobType === 'send_outbound_message' && e.payload.conversation_id === fixture.id,
  );

  // Extract the actual escalation rule name from the reasoning summary, if any.
  const reasoning = decision.reasoningSummary ?? '';
  const ruleMatch = /Escalated by (\w+):/.exec(reasoning);
  const actualRule: string | null = ruleMatch ? ruleMatch[1]! : null;

  // Confidence check
  const confidencePass = decision.confidence >= fixture.expected.minConfidence;

  // Rubric scoring (LLM-as-judge or heuristic)
  const lastMsg = seedMsgs[seedMsgs.length - 1]?.body ?? '';
  const judgeResult = await judge.judge({
    contactMessage: lastMsg,
    responseText: decision.responseText ?? '',
    rubric: fixture.rubric,
  });
  // Add harness-side checks for criteria the judge can't decide from
  // response text alone (e.g. "decision tags include X").
  const harnessScores: Array<{ id: string; score: number; note: string }> = [];
  for (const c of fixture.rubric.criteria) {
    const desc = c.description.toLowerCase();
    if (desc.includes('no llm was called') || desc.includes('no-llm-call')) {
      // Already handled by judge based on responseText emptiness.
      continue;
    }
    if (desc.includes('tags include')) {
      const m = /tags include\s+"?([\w_-]+)"?/i.exec(c.description);
      const target = m ? m[1] : '';
      const present = decision.tags.includes(target);
      harnessScores.push({
        id: c.id,
        score: present ? 1 : 0,
        note: present ? `Tags include "${target}".` : `Tags [${decision.tags.join(', ')}] missing "${target}".`,
      });
    } else if (desc.includes('reasoning mentions') || desc.includes('reasoning summary')) {
      const m = /mentions?\s+"?([\w_ -]+)"?/i.exec(c.description);
      const target = m ? m[1].toLowerCase().trim() : '';
      const present = target && reasoning.toLowerCase().includes(target);
      harnessScores.push({
        id: c.id,
        score: present ? 1 : 0,
        note: present ? `Reasoning mentions "${target}".` : `Reasoning "${reasoning.slice(0, 80)}..." does not mention "${target}".`,
      });
    } else if (desc.includes('decision is marked') || desc.includes('marked requires_human')) {
      const present = decision.requiresHuman;
      harnessScores.push({
        id: c.id,
        score: present ? 1 : 0,
        note: present ? 'requires_human=true.' : 'requires_human=false.',
      });
    } else if (desc.includes('decision has no response_text') || desc.includes('no response_text')) {
      const noText = decision.responseText == null || decision.responseText === '';
      harnessScores.push({
        id: c.id,
        score: noText ? 1 : 0,
        note: noText ? 'responseText is null/empty.' : `responseText: "${decision.responseText?.slice(0, 60)}..."`,
      });
    } else if (desc.includes('no escalation') || desc.includes('no-escalation')) {
      const notEscalated = decision.decisionType !== 'escalate' && !decision.requiresHuman;
      harnessScores.push({
        id: c.id,
        score: notEscalated ? 1 : 0,
        note: notEscalated ? 'Not escalated.' : 'Escalated when it should not have been.',
      });
    } else if (desc.includes('disabled')) {
      const isDisabled = reasoning.toLowerCase().includes('disabled');
      harnessScores.push({
        id: c.id,
        score: isDisabled ? 1 : 0,
        note: isDisabled ? 'Reasoning mentions disabled.' : 'Reasoning does not mention disabled.',
      });
    }
  }

  // Merge judge + harness scores by criterion id (harness takes precedence).
  const scoreMap = new Map<string, { id: string; score: number; note: string }>();
  for (const s of judgeResult.scores) scoreMap.set(s.id, s);
  for (const s of harnessScores) scoreMap.set(s.id, s);

  const finalScores = fixture.rubric.criteria.map(
    (c) => scoreMap.get(c.id) ?? { id: c.id, score: 0, note: 'no score' },
  );

  // Apply threshold-kind criteria: below threshold = 0.
  const adjusted = finalScores.map((s, i) => {
    const c = fixture.rubric.criteria[i];
    if (c.kind === 'threshold' && c.threshold != null && s.score < c.threshold) {
      return { ...s, score: 0, note: `${s.note} (below threshold ${c.threshold}, score ${s.score})` };
    }
    return s;
  });

  const rubricMean =
    adjusted.length === 0
      ? 1
      : adjusted.reduce((acc, s) => acc + s.score, 0) / adjusted.length;
  // Pass = at least one criterion and all criteria score >= 1 for binary
  // kind, and >= threshold for threshold kind.
  const rubricPass = adjusted.every((s, i) => {
    const c = fixture.rubric.criteria[i];
    if (c.kind === 'binary') return s.score >= 1;
    return s.score >= 1; // threshold-adjusted, so score=1 means passed.
  });

  // Decision-shape checks (not part of the rubric; track separately for CSV).
  const shapeChecks: Array<{ id: string; pass: boolean; note: string }> = [];
  if (fixture.expected.expectedEscalationRule) {
    shapeChecks.push({
      id: 'check-escalation-rule',
      pass: actualRule === fixture.expected.expectedEscalationRule,
      note: `expected=${fixture.expected.expectedEscalationRule} actual=${actualRule}`,
    });
  }
  if (fixture.expected.expectOutboundEnqueued != null) {
    shapeChecks.push({
      id: 'check-outbound-enqueued',
      pass: actualOutboundEnqueued === fixture.expected.expectOutboundEnqueued,
      note: `expected=${fixture.expected.expectOutboundEnqueued} actual=${actualOutboundEnqueued}`,
    });
  }
  if (fixture.expected.requiresHuman !== actualRequiresHuman) {
    shapeChecks.push({
      id: 'check-requires-human',
      pass: false,
      note: `expected=${fixture.expected.requiresHuman} actual=${actualRequiresHuman}`,
    });
  } else {
    shapeChecks.push({
      id: 'check-requires-human',
      pass: true,
      note: `both=${fixture.expected.requiresHuman}`,
    });
  }

  return {
    fixtureId: fixture.id,
    label: fixture.label,
    expectedDecision: fixture.expected.decision,
    actualDecision,
    decisionMatch,
    expectedRule: fixture.expected.expectedEscalationRule,
    actualRule,
    expectedRequiresHuman: fixture.expected.requiresHuman,
    actualRequiresHuman,
    expectedOutboundEnqueued: fixture.expected.expectOutboundEnqueued,
    actualOutboundEnqueued,
    confidence: decision.confidence,
    minConfidence: fixture.expected.minConfidence,
    confidencePass,
    responseText: decision.responseText ?? '',
    rubricPass,
    rubricMean,
    rubricScores: adjusted,
    tags: decision.tags,
    decisionShapeChecks: shapeChecks,
  };
}

// ─── CSV writer ────────────────────────────────────────────────────

function csvEscape(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  if (s.includes('"') || s.includes(',') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function writeCsv(scores: FixtureScore[], outPath: string): void {
  const header = [
    'conversation_id',
    'label',
    'expected_decision',
    'actual_decision',
    'decision_match',
    'expected_escalation_rule',
    'actual_escalation_rule',
    'expected_requires_human',
    'actual_requires_human',
    'expected_outbound_enqueued',
    'actual_outbound_enqueued',
    'confidence',
    'min_confidence',
    'confidence_pass',
    'rubric_pass',
    'rubric_mean',
    'rubric_score_ids',
    'response_text',
    'tags',
    'shape_checks_pass',
    'shape_checks_total',
  ];
  const rows = scores.map((s) => [
    s.fixtureId,
    s.label,
    s.expectedDecision,
    s.actualDecision,
    s.decisionMatch ? '1' : '0',
    s.expectedRule ?? '',
    s.actualRule ?? '',
    s.expectedRequiresHuman ? '1' : '0',
    s.actualRequiresHuman ? '1' : '0',
    s.expectedOutboundEnqueued == null ? '' : s.expectedOutboundEnqueued ? '1' : '0',
    s.actualOutboundEnqueued ? '1' : '0',
    s.confidence.toFixed(3),
    s.minConfidence.toFixed(3),
    s.confidencePass ? '1' : '0',
    s.rubricPass ? '1' : '0',
    s.rubricMean.toFixed(3),
    s.rubricScores.map((r) => `${r.id}=${r.score.toFixed(2)}`).join('|'),
    s.responseText.slice(0, 200),
    s.tags.join(','),
    s.decisionShapeChecks.filter((c) => c.pass).length,
    s.decisionShapeChecks.length,
  ]);
  const lines = [header, ...rows].map((r) => r.map(csvEscape).join(','));
  fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
}

// ─── Markdown summary writer ───────────────────────────────────────

function writeMarkdown(
  scores: FixtureScore[],
  label: string,
  outPath: string,
): void {
  const total = scores.length;
  const decisionCorrect = scores.filter((s) => s.decisionMatch).length;
  const confidencePass = scores.filter((s) => s.confidencePass).length;
  const rubricPass = scores.filter((s) => s.rubricPass).length;
  const shapePasses = scores.reduce(
    (acc, s) => acc + s.decisionShapeChecks.filter((c) => c.pass).length,
    0,
  );
  const shapeTotal = scores.reduce((acc, s) => acc + s.decisionShapeChecks.length, 0);

  const failures = scores.filter(
    (s) => !s.decisionMatch || !s.confidencePass || !s.rubricPass,
  );

  const lines: string[] = [];
  lines.push(`# AI Evaluation Report — ${label}`);
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Fixtures: ${total}`);
  lines.push('');
  lines.push('## Overall');
  lines.push('');
  lines.push(`- Decision match: **${decisionCorrect}/${total}** (${pct(decisionCorrect, total)})`);
  lines.push(`- Confidence pass: **${confidencePass}/${total}** (${pct(confidencePass, total)})`);
  lines.push(`- Rubric pass: **${rubricPass}/${total}** (${pct(rubricPass, total)})`);
  lines.push(`- Decision-shape pass: **${shapePasses}/${shapeTotal}** (${pct(shapePasses, shapeTotal)})`);
  lines.push('');

  if (failures.length > 0) {
    lines.push('## Failures');
    lines.push('');
    for (const f of failures) {
      const reasons: string[] = [];
      if (!f.decisionMatch) reasons.push(`decision ${f.expectedDecision}≠${f.actualDecision}`);
      if (!f.confidencePass) reasons.push(`confidence ${f.confidence.toFixed(2)}<${f.minConfidence.toFixed(2)}`);
      if (!f.rubricPass) reasons.push(`rubric failed`);
      lines.push(`- \`${f.fixtureId}\` (${f.label}): ${reasons.join(', ')}`);
    }
    lines.push('');
  }

  lines.push('## Per-fixture detail');
  lines.push('');
  lines.push('| ID | Label | Decision | Confidence | Rubric |');
  lines.push('|---|---|---|---|---|');
  for (const s of scores) {
    const dec = s.decisionMatch ? '✅' : '❌';
    const conf = s.confidencePass ? '✅' : '❌';
    const rub = s.rubricPass ? '✅' : '❌';
    lines.push(`| \`${s.fixtureId}\` | ${s.label} | ${dec} ${s.actualDecision} | ${conf} ${s.confidence.toFixed(2)} | ${rub} ${s.rubricMean.toFixed(2)} |`);
  }
  lines.push('');

  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
}

function pct(n: number, d: number): string {
  if (d === 0) return '0%';
  return `${Math.round((1000 * n) / d) / 10}%`;
}

// ─── Public entry point ────────────────────────────────────────────

export interface RunOptions {
  label: string;
  recording?: Recording;
  fixtures?: GoldenConversation[];
  judge?: RubricJudge;
  outDir?: string;
}

export interface RunResult {
  label: string;
  total: number;
  decisionCorrect: number;
  confidencePass: number;
  rubricPass: number;
  shapePasses: number;
  shapeTotal: number;
  rubricPassRate: number;
  decisionAccuracy: number;
  scores: FixtureScore[];
  csvPath: string;
  mdPath: string;
  jsonPath: string;
}

export async function runHarness(opts: RunOptions): Promise<RunResult> {
  const aiClient = new MockAiClient(opts.recording ?? DEFAULT_RECORDING);
  const judge = opts.judge ?? new HeuristicRubricJudge();
  const fixtures = opts.fixtures ?? GOLDEN_CONVERSATIONS;
  const outDir = opts.outDir ?? OUTPUT_DIR;
  fs.mkdirSync(outDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseName = `results-${opts.label}-${stamp}`;

  const scores: FixtureScore[] = [];
  for (const f of fixtures) {
    const s = await runFixture(f, aiClient, judge);
    scores.push(s);
  }

  const csvPath = path.join(outDir, `${baseName}.csv`);
  const mdPath = path.join(outDir, `${baseName}.md`);
  const jsonPath = path.join(outDir, `${baseName}.json`);

  writeCsv(scores, csvPath);
  writeMarkdown(scores, opts.label, mdPath);

  const total = scores.length;
  const decisionCorrect = scores.filter((s) => s.decisionMatch).length;
  const confidencePass = scores.filter((s) => s.confidencePass).length;
  const rubricPass = scores.filter((s) => s.rubricPass).length;
  const shapePasses = scores.reduce(
    (acc, s) => acc + s.decisionShapeChecks.filter((c) => c.pass).length,
    0,
  );
  const shapeTotal = scores.reduce((acc, s) => acc + s.decisionShapeChecks.length, 0);

  const summary = {
    label: opts.label,
    timestamp: new Date().toISOString(),
    total,
    decisionCorrect,
    decisionAccuracy: total === 0 ? 0 : decisionCorrect / total,
    confidencePass,
    rubricPass,
    rubricPassRate: total === 0 ? 0 : rubricPass / total,
    shapePasses,
    shapeTotal,
  };
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2), 'utf8');

  return {
    ...summary,
    scores,
    csvPath,
    mdPath,
    jsonPath,
  };
}

// ─── CLI ───────────────────────────────────────────────────────────

interface CliArgs {
  label: string;
  recordingPath?: string;
  baselinePath?: string;
  fixturesFilter?: string;
  printConsole?: boolean;
  exitOnFail?: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    label: process.env.EVAL_LABEL ?? 'mock-gpt-4o-mini',
    printConsole: true,
    exitOnFail: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--label' && argv[i + 1]) {
      args.label = argv[++i];
    } else if (a === '--recording' && argv[i + 1]) {
      args.recordingPath = argv[++i];
    } else if (a === '--baseline' && argv[i + 1]) {
      args.baselinePath = argv[++i];
    } else if (a === '--filter' && argv[i + 1]) {
      args.fixturesFilter = argv[++i];
    } else if (a === '--quiet') {
      args.printConsole = false;
    } else if (a === '--exit-on-fail') {
      args.exitOnFail = true;
    }
  }
  return args;
}

function loadRecording(p: string): Recording {
  const text = fs.readFileSync(p, 'utf8');
  return JSON.parse(text) as Recording;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const recording = args.recordingPath ? loadRecording(args.recordingPath) : undefined;
  let fixtures = GOLDEN_CONVERSATIONS;
  if (args.fixturesFilter) {
    fixtures = fixtures.filter((f) => f.id.includes(args.fixturesFilter!));
  }
  const result = await runHarness({
    label: args.label,
    recording,
    fixtures,
  });

  if (args.printConsole) {
    console.log('');
    console.log('──────────────────────────────────────────────');
    console.log(`Eval run: ${result.label}`);
    console.log(`Total: ${result.total}`);
    console.log(`Decision accuracy:  ${result.decisionCorrect}/${result.total} (${pct(result.decisionCorrect, result.total)})`);
    console.log(`Confidence pass:    ${result.confidencePass}/${result.total}`);
    console.log(`Rubric pass:        ${result.rubricPass}/${result.total} (${pct(result.rubricPass, result.total)})`);
    console.log(`Shape pass:         ${result.shapePasses}/${result.shapeTotal}`);
    console.log(`CSV:    ${result.csvPath}`);
    console.log(`Report: ${result.mdPath}`);
    console.log(`JSON:   ${result.jsonPath}`);
    console.log('──────────────────────────────────────────────');
  }

  if (args.exitOnFail && result.rubricPass < result.total) {
    process.exitCode = 1;
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
