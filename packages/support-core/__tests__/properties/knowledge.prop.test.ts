import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { splitIntoChunks } from '@support-core/utils/chunking';
import type { DatabaseClient, QueryBuilder, QueryResult } from '@support-core/interfaces/database-client';
import { KnowledgeRepository } from '@support-core/repositories/knowledge-repository';

/**
 * Property-based tests for the knowledge base.
 *
 * Feature: ai-customer-support
 */

// ─── Helpers ──────────────────────────────────────────────────────────

/** Arbitrary for non-empty document bodies with paragraph structure. */
const documentBodyArb = fc.oneof(
  // Simple single-paragraph body
  fc.string({ minLength: 1, maxLength: 2000 }).filter((s) => s.trim().length > 0),
  // Multi-paragraph body with double newlines
  fc
    .array(
      fc.string({ minLength: 1, maxLength: 600 }).filter((s) => s.trim().length > 0),
      { minLength: 1, maxLength: 10 },
    )
    .map((paragraphs) => paragraphs.join('\n\n')),
);

/** Arbitrary for embedding vectors (1536-dimensional, normalized). */
const embeddingArb = fc
  .array(fc.double({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true }), {
    minLength: 1536,
    maxLength: 1536,
  });

/** Arbitrary for similarity scores (0 to 1). */
const similarityArb = fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true });

/** Arbitrary for threshold values (0 to 1). */
const thresholdArb = fc.double({ min: 0, max: 0.99, noNaN: true, noDefaultInfinity: true });

/** Arbitrary for limit values. */
const limitArb = fc.integer({ min: 1, max: 50 });

/** Cosine similarity between two vectors. */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

/** Create a mock DatabaseClient for matchChunks testing. */
function createMockDbForMatch(options: {
  chunks: Array<{
    id: string;
    documentId: string;
    content: string;
    embedding: number[];
    metadata: Record<string, unknown>;
  }>;
  orgId: string;
}): DatabaseClient {
  const { chunks, orgId } = options;

  return {
    from: vi.fn().mockImplementation(() => {
      throw new Error('from() should not be called for matchChunks');
    }),
    rpc: vi.fn().mockImplementation(
      async (
        functionName: string,
        args: Record<string, unknown>,
      ): Promise<QueryResult> => {
        if (functionName !== 'match_knowledge_chunks') {
          return { data: null, error: { message: `Unknown RPC: ${functionName}` } };
        }

        const queryEmbedding = args.query_embedding as number[];
        const matchOrgId = args.match_org_id as string;
        const matchLimit = (args.match_limit as number) ?? 5;
        const matchThreshold = (args.match_threshold as number) ?? 0.7;

        // Filter chunks by org, compute similarity, filter by threshold, sort, limit
        const results = chunks
          .filter(() => matchOrgId === orgId)
          .map((chunk) => ({
            id: chunk.id,
            document_id: chunk.documentId,
            content: chunk.content,
            metadata: chunk.metadata,
            similarity: cosineSimilarity(queryEmbedding, chunk.embedding),
          }))
          .filter((r) => r.similarity > matchThreshold)
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, matchLimit);

        return { data: results, error: null };
      },
    ),
  };
}

// ─── Property Tests ───────────────────────────────────────────────────

describe('Knowledge base property tests', () => {
  /**
   * Property 16: Knowledge chunk similarity ordering
   *
   * For any query embedding and set of chunks, matchChunks returns chunks
   * ordered by cosine similarity descending, all above threshold, count ≤ limit.
   *
   * **Validates: Requirements 10.5**
   *
   * Feature: ai-customer-support, Property 16: Knowledge chunk similarity ordering
   */
  it('Property 16: matchChunks returns chunks ordered by similarity descending, above threshold, within limit', async () => {
    // Use a smaller embedding size for test performance
    const smallEmbeddingArb = fc.array(
      fc.double({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true }),
      { minLength: 8, maxLength: 8 },
    );

    await fc.assert(
      fc.asyncProperty(
        smallEmbeddingArb,
        fc.array(
          fc.record({
            id: fc.uuid(),
            documentId: fc.uuid(),
            content: fc.string({ minLength: 1, maxLength: 100 }),
            embedding: smallEmbeddingArb,
            metadata: fc.constant({} as Record<string, unknown>),
          }),
          { minLength: 0, maxLength: 15 },
        ),
        thresholdArb,
        limitArb,
        async (queryEmbedding, chunks, threshold, limit) => {
          const orgId = 'org-test-123';

          // We need to use 1536-dim embeddings for the repository since it
          // calls the RPC which we mock. But for the mock, we use the small
          // embeddings directly since we control the RPC implementation.
          const db = createMockDbForMatch({ chunks, orgId });
          const repo = new KnowledgeRepository(db);

          const results = await repo.matchChunks(queryEmbedding, orgId, limit, threshold);

          // 1. Count ≤ limit
          expect(results.length).toBeLessThanOrEqual(limit);

          // 2. All results should have similarity above threshold
          // (We verify this by recomputing similarity for each result)
          for (const result of results) {
            const originalChunk = chunks.find((c) => c.id === result.id);
            if (originalChunk) {
              const sim = cosineSimilarity(queryEmbedding, originalChunk.embedding);
              expect(sim).toBeGreaterThan(threshold);
            }
          }

          // 3. Results should be ordered by similarity descending
          if (results.length >= 2) {
            for (let i = 0; i < results.length - 1; i++) {
              const chunkA = chunks.find((c) => c.id === results[i].id);
              const chunkB = chunks.find((c) => c.id === results[i + 1].id);
              if (chunkA && chunkB) {
                const simA = cosineSimilarity(queryEmbedding, chunkA.embedding);
                const simB = cosineSimilarity(queryEmbedding, chunkB.embedding);
                expect(simA).toBeGreaterThanOrEqual(simB);
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 17: Document chunking coverage
   *
   * For any non-empty document body, the chunking function produces at least
   * one chunk, and concatenating all chunks contains all text from the original body.
   *
   * **Validates: Requirements 10.1**
   *
   * Feature: ai-customer-support, Property 17: Document chunking coverage
   */
  it('Property 17: splitIntoChunks produces at least one chunk and preserves all text content', () => {
    fc.assert(
      fc.property(documentBodyArb, (body) => {
        const chunks = splitIntoChunks(body);

        // 1. At least one chunk for non-empty body
        expect(chunks.length).toBeGreaterThanOrEqual(1);

        // 2. All chunks should be non-empty
        for (const chunk of chunks) {
          expect(chunk.trim().length).toBeGreaterThan(0);
        }

        // 3. Concatenating all chunks should contain all non-whitespace text
        //    from the original body (no content loss).
        //    We compare by stripping all whitespace from both sides since
        //    chunking trims paragraphs and may adjust whitespace.
        const originalWords = body
          .split(/\s+/)
          .filter((w) => w.length > 0);
        const chunkedText = chunks.join(' ');
        const chunkedWords = chunkedText
          .split(/\s+/)
          .filter((w) => w.length > 0);

        // Every word from the original should appear in the chunked output
        for (const word of originalWords) {
          expect(chunkedText).toContain(word);
        }

        // No words should be added that weren't in the original
        for (const word of chunkedWords) {
          expect(body).toContain(word);
        }
      }),
      { numRuns: 100 },
    );
  });
});
