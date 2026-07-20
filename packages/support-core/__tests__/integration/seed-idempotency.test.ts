import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';

const RUN_LIVE = process.env.INBOXPILOT_LIVE_INTEGRATION === '1';
const SEED_ORGANIZATION_ID = 'a0000000-0000-4000-8000-000000000001';
const PRODUCTION_HOST = 'https://y39ezar3.us-east.insforge.app';
const ANSI_ESCAPE = /\u001b\[[0-9;]*m/g;

interface LinkedProject {
  project_name?: string;
  oss_host?: string;
  branched_from?: {
    project_id?: string;
  };
}

interface SeedCounts {
  organizations: number;
  contacts: number;
  conversations: number;
  messages: number;
  knowledgeDocuments: number;
  aiSettings: number;
  aiDecisions: number;
  ownedDrafts: number;
}

function assertDisposableBranch(): void {
  const project = JSON.parse(
    readFileSync(resolve(process.cwd(), '.insforge/project.json'), 'utf8'),
  ) as LinkedProject;

  if (
    !project.branched_from?.project_id ||
    !project.project_name?.startsWith('qa-') ||
    !project.oss_host ||
    project.oss_host === PRODUCTION_HOST
  ) {
    throw new Error(
      'Live seed integration tests require a linked disposable qa-* InsForge branch; refusing to mutate the current project.',
    );
  }
}

function runSql(sql: string): string {
  const result = spawnSync(
    'npx',
    ['--yes', '@insforge/cli@0.2.0', 'db', 'query', '--unrestricted', '--', sql],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120_000,
    },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `InsForge CLI query failed: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return result.stdout.replace(ANSI_ESCAPE, '');
}

function readSeedCounts(): SeedCounts {
  const output = runSql(`
    SELECT 'INBOXPILOT_SEED_COUNTS:' || json_build_object(
      'organizations', (SELECT count(*) FROM organizations WHERE id = '${SEED_ORGANIZATION_ID}'),
      'contacts', (SELECT count(*) FROM contacts WHERE organization_id = '${SEED_ORGANIZATION_ID}'),
      'conversations', (SELECT count(*) FROM conversations WHERE organization_id = '${SEED_ORGANIZATION_ID}'),
      'messages', (
        SELECT count(*)
        FROM messages AS message
        JOIN conversations AS conversation ON conversation.id = message.conversation_id
        WHERE conversation.organization_id = '${SEED_ORGANIZATION_ID}'
      ),
      'knowledgeDocuments', (SELECT count(*) FROM knowledge_documents WHERE organization_id = '${SEED_ORGANIZATION_ID}'),
      'aiSettings', (SELECT count(*) FROM ai_settings WHERE organization_id = '${SEED_ORGANIZATION_ID}'),
      'aiDecisions', (SELECT count(*) FROM ai_decisions WHERE organization_id = '${SEED_ORGANIZATION_ID}'),
      'ownedDrafts', (
        SELECT count(*)
        FROM conversations
        WHERE organization_id = '${SEED_ORGANIZATION_ID}'
          AND ai_state = 'drafted'
          AND pending_ai_decision_id IS NOT NULL
      )
    )::text AS seed_counts;
  `);
  const match = output.match(/INBOXPILOT_SEED_COUNTS:(\{[^\r\n]+\})/);
  if (!match?.[1]) {
    throw new Error(`Could not parse seed counts from InsForge CLI output: ${output}`);
  }
  return JSON.parse(match[1]) as SeedCounts;
}

describe.skipIf(!RUN_LIVE)('Integration: Seed Script Idempotency', () => {
  let firstRun: SeedCounts;
  let secondRun: SeedCounts;

  beforeAll(() => {
    assertDisposableBranch();
    runSql(`DELETE FROM organizations WHERE id = '${SEED_ORGANIZATION_ID}';`);
    const seedSql = readFileSync(resolve(process.cwd(), 'insforge/seed.sql'), 'utf8');
    runSql(seedSql);
    firstRun = readSeedCounts();
    runSql(seedSql);
    secondRun = readSeedCounts();
  }, 120_000);

  it('running the seed script once creates the expected records', () => {
    expect(firstRun).toEqual({
      organizations: 1,
      contacts: 3,
      conversations: 5,
      messages: 9,
      knowledgeDocuments: 2,
      aiSettings: 1,
      aiDecisions: 1,
      ownedDrafts: 1,
    });
  });

  it.each([
    ['organizations', 1],
    ['contacts', 3],
    ['conversations', 5],
    ['messages', 9],
    ['knowledgeDocuments', 2],
    ['aiSettings', 1],
    ['aiDecisions', 1],
    ['ownedDrafts', 1],
  ] as const)('running the seed script twice keeps %s at %i', (key, expected) => {
    expect(secondRun[key]).toBe(expected);
    expect(secondRun[key]).toBe(firstRun[key]);
  });
});
