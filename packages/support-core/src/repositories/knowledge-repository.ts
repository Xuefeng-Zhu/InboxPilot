/**
 * KnowledgeRepository — data access for knowledge_documents and knowledge_chunks tables.
 *
 * Accepts a DatabaseClient via constructor injection (never imports InsForge SDK).
 * Handles snake_case ↔ camelCase mapping between the database and TypeScript types.
 */

import type { DatabaseClient } from '../interfaces/database-client.js';
import type {
  KnowledgeDocument,
  KnowledgeDocumentStatus,
  KnowledgeChunk,
  CreateDocumentInput,
  CreateChunkInput,
} from '../types/index.js';

/** Raw row shape for knowledge_documents. */
interface DocumentRow {
  id: string;
  organization_id: string;
  title: string;
  source_type: string;
  body: string;
  status: KnowledgeDocumentStatus;
  error_message: string | null;
  file_url: string | null;
  file_name: string | null;
  created_at: string;
  updated_at: string;
}

/** Raw row shape for knowledge_chunks. */
interface ChunkRow {
  id: string;
  document_id: string;
  organization_id: string;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  created_at: string;
}

/** Raw row shape returned by the match_knowledge_chunks RPC. */
interface MatchChunkRow {
  id: string;
  document_id: string;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
}

/** Raw row shape returned by lexical chunk fallback search. */
interface TextSearchChunkRow {
  id: string;
  document_id: string;
  organization_id: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

const TEXT_SEARCH_STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'also',
  'are',
  'can',
  'could',
  'does',
  'for',
  'from',
  'have',
  'how',
  'into',
  'our',
  'please',
  'the',
  'their',
  'there',
  'this',
  'what',
  'when',
  'where',
  'which',
  'with',
  'would',
  'you',
  'your',
]);

function buildTextSearchTerms(query: string): string[] {
  const words = query
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.filter((word) => word.length >= 3 && !TEXT_SEARCH_STOP_WORDS.has(word)) ?? [];

  const phrases: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    phrases.push(`${words[i]} ${words[i + 1]}`);
  }

  const compactQuery = words.join(' ');
  const terms = compactQuery.includes(' ')
    ? [compactQuery, ...phrases, ...words]
    : [...phrases, ...words];

  return Array.from(new Set(terms)).slice(0, 8);
}

/** Convert a database row to a KnowledgeDocument entity. */
function toDocument(row: DocumentRow): KnowledgeDocument {
  return {
    id: row.id,
    organizationId: row.organization_id,
    title: row.title,
    sourceType: row.source_type,
    body: row.body,
    status: row.status,
    errorMessage: row.error_message,
    fileUrl: row.file_url,
    fileName: row.file_name,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/** Convert a database row to a KnowledgeChunk entity. */
function toChunk(row: ChunkRow): KnowledgeChunk {
  return {
    id: row.id,
    documentId: row.document_id,
    organizationId: row.organization_id,
    content: row.content,
    embedding: row.embedding,
    metadata: row.metadata,
    createdAt: new Date(row.created_at),
  };
}

export class KnowledgeRepository {
  constructor(private db: DatabaseClient) {}

  /** Load a knowledge document by ID. Returns null if not found. */
  async getDocument(id: string): Promise<KnowledgeDocument | null> {
    const { data, error } = await this.db
      .from('knowledge_documents')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`KnowledgeRepository.getDocument failed: ${error.message}`);
    }

    if (!data) return null;

    return toDocument(data as DocumentRow);
  }

  /** Create a new knowledge document record. */
  async createDocument(input: CreateDocumentInput): Promise<KnowledgeDocument> {
    const row: Record<string, unknown> = {
      organization_id: input.organizationId,
      title: input.title,
      source_type: input.sourceType,
      body: input.body,
    };

    const { data, error } = await this.db
      .from('knowledge_documents')
      .insert(row)
      .select('*')
      .single();

    if (error) {
      throw new Error(`KnowledgeRepository.createDocument failed: ${error.message}`);
    }

    return toDocument(data as DocumentRow);
  }

  /** Update an existing knowledge document by id. */
  async updateDocument(
    id: string,
    updates: Partial<KnowledgeDocument>,
  ): Promise<KnowledgeDocument> {
    const row: Record<string, unknown> = {};

    if (updates.title !== undefined) row.title = updates.title;
    if (updates.sourceType !== undefined) row.source_type = updates.sourceType;
    if (updates.body !== undefined) row.body = updates.body;
    if (updates.status !== undefined) row.status = updates.status;
    if (updates.errorMessage !== undefined) row.error_message = updates.errorMessage;
    row.updated_at = new Date().toISOString();

    const { data, error } = await this.db
      .from('knowledge_documents')
      .update(row)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw new Error(`KnowledgeRepository.updateDocument failed: ${error.message}`);
    }

    return toDocument(data as DocumentRow);
  }

  /** Delete a knowledge document and all associated chunks (cascade). */
  async deleteDocumentWithChunks(id: string): Promise<void> {
    // Chunks are deleted via ON DELETE CASCADE in the database schema,
    // but we explicitly delete them first for clarity and portability.
    await this.deleteChunksByDocument(id);

    const { error } = await this.db
      .from('knowledge_documents')
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(`KnowledgeRepository.deleteDocumentWithChunks failed: ${error.message}`);
    }
  }

  /** Insert multiple knowledge chunks at once. */
  async insertChunks(chunks: CreateChunkInput[]): Promise<KnowledgeChunk[]> {
    if (chunks.length === 0) return [];

    const rows = chunks.map((chunk) => ({
      document_id: chunk.documentId,
      organization_id: chunk.organizationId,
      content: chunk.content,
      embedding: chunk.embedding,
      metadata: chunk.metadata ?? {},
    }));

    const { data, error } = await this.db
      .from('knowledge_chunks')
      .insert(rows)
      .select('*');

    if (error) {
      throw new Error(`KnowledgeRepository.insertChunks failed: ${error.message}`);
    }

    const resultRows = (data ?? []) as ChunkRow[];
    return resultRows.map(toChunk);
  }

  /** Atomically replace all chunks belonging to a document. */
  async replaceChunksByDocument(
    documentId: string,
    organizationId: string,
    chunks: CreateChunkInput[],
  ): Promise<KnowledgeChunk[]> {
    const mismatchedChunk = chunks.find(
      (chunk) => chunk.documentId !== documentId || chunk.organizationId !== organizationId,
    );
    if (mismatchedChunk) {
      throw new Error('KnowledgeRepository.replaceChunksByDocument failed: chunk document/org mismatch');
    }

    const { data, error } = await this.db.rpc('replace_knowledge_chunks', {
      p_document_id: documentId,
      p_organization_id: organizationId,
      p_chunks: chunks.map((chunk) => ({
        content: chunk.content,
        embedding: chunk.embedding,
        metadata: chunk.metadata ?? {},
      })),
    });

    if (error) {
      throw new Error(`KnowledgeRepository.replaceChunksByDocument failed: ${error.message}`);
    }

    const resultRows = (data ?? []) as ChunkRow[];
    return resultRows.map(toChunk);
  }

  /** Delete all chunks belonging to a document. */
  async deleteChunksByDocument(documentId: string): Promise<void> {
    const { error } = await this.db
      .from('knowledge_chunks')
      .delete()
      .eq('document_id', documentId);

    if (error) {
      throw new Error(`KnowledgeRepository.deleteChunksByDocument failed: ${error.message}`);
    }
  }

  /**
   * Match knowledge chunks by cosine similarity using the match_knowledge_chunks RPC.
   * Returns chunks ordered by similarity descending, above the given threshold.
   */
  async matchChunks(
    queryEmbedding: number[],
    orgId: string,
    limit: number,
    threshold: number,
  ): Promise<KnowledgeChunk[]> {
    const { data, error } = await this.db.rpc('match_knowledge_chunks', {
      query_embedding: queryEmbedding,
      match_org_id: orgId,
      match_limit: limit,
      match_threshold: threshold,
    });

    if (error) {
      throw new Error(`KnowledgeRepository.matchChunks failed: ${error.message}`);
    }

    // The RPC returns a different shape than the full chunk row — it includes
    // similarity but not organization_id or embedding. We map to KnowledgeChunk
    // with the org ID from the query and an empty embedding (not needed for results).
    const rows = (data ?? []) as MatchChunkRow[];
    return rows.map((row) => ({
      id: row.id,
      documentId: row.document_id,
      organizationId: orgId,
      content: row.content,
      embedding: [],
      metadata: row.metadata,
      createdAt: new Date(),
    }));
  }

  /**
   * Fallback lexical search for short user questions where semantic similarity
   * can miss exact knowledge-base wording such as plan names or feature labels.
   */
  async searchChunksByText(
    orgId: string,
    query: string,
    limit: number,
  ): Promise<KnowledgeChunk[]> {
    const terms = buildTextSearchTerms(query);
    if (terms.length === 0) return [];

    const rowsById = new Map<string, TextSearchChunkRow>();

    for (const term of terms) {
      const { data, error } = await this.db
        .from('knowledge_chunks')
        .select('id,document_id,organization_id,content,metadata,created_at')
        .eq('organization_id', orgId)
        .ilike('content', `%${term}%`)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        throw new Error(`KnowledgeRepository.searchChunksByText failed: ${error.message}`);
      }

      const rows = (data ?? []) as TextSearchChunkRow[];
      for (const row of rows) {
        if (!rowsById.has(row.id)) {
          rowsById.set(row.id, row);
        }
      }

      if (rowsById.size >= limit) break;
    }

    return Array.from(rowsById.values())
      .slice(0, limit)
      .map((row) => ({
        id: row.id,
        documentId: row.document_id,
        organizationId: row.organization_id,
        content: row.content,
        embedding: [],
        metadata: row.metadata,
        createdAt: new Date(row.created_at),
      }));
  }
}
