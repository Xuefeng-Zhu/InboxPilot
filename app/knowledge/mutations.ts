import { MAX_FILE_SIZE_MB, type KnowledgeDocument } from '@/components/knowledge/types';
import { insforge } from '@/lib/insforge';
import {
  removeKnowledgeFile,
  rollbackKnowledgeUpload,
  uploadKnowledgeFile,
} from './storage';
import { createJobIdempotencyKey } from '@support-core/services/postgres-job-queue';

export interface NewKnowledgeDocument {
  title: string;
  sourceType: string;
  body: string;
  file: File | null;
}

export interface KnowledgeMutationResult {
  warnings: string[];
}

export interface CreatedKnowledgeDocumentResult extends KnowledgeMutationResult {
  documentId: string;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

async function writeKnowledgeAudit(input: {
  organizationId: string;
  actorId: string;
  action: 'knowledge_document_created' | 'knowledge_document_updated' | 'knowledge_document_deleted';
  documentId: string;
  metadata: Record<string, unknown>;
}): Promise<string | null> {
  try {
    const { error } = await insforge.database
      .from('audit_logs')
      .insert([{
        organization_id: input.organizationId,
        actor_id: input.actorId,
        actor_type: 'user',
        action: input.action,
        resource_type: 'knowledge_document',
        resource_id: input.documentId,
        metadata: input.metadata,
      }]);
    return error ? `audit logging failed: ${error.message}` : null;
  } catch (error) {
    return `audit logging failed: ${errorMessage(error, 'unknown error')}`;
  }
}

async function enqueueKnowledgeProcessing(input: {
  organizationId: string;
  documentId: string;
  revision: string;
}): Promise<string | null> {
  try {
    const payload = { documentId: input.documentId, revision: input.revision };
    const { error } = await insforge.database
      .from('support_jobs')
      .insert([{
        organization_id: input.organizationId,
        job_type: 'process_knowledge_document',
        payload,
        idempotency_key: createJobIdempotencyKey(
          'process_knowledge_document',
          payload,
        ),
        status: 'pending',
        attempts: 0,
        max_attempts: 3,
        run_after: new Date().toISOString(),
      }]);
    if (error?.code === '23505') return null;
    return error ? `processing could not be queued: ${error.message}` : null;
  } catch (error) {
    return `processing could not be queued: ${errorMessage(error, 'unknown error')}`;
  }
}

async function runPostWriteTasks(input: {
  organizationId: string;
  actorId: string;
  action: 'knowledge_document_created' | 'knowledge_document_updated';
  documentId: string;
  metadata: Record<string, unknown>;
  revision: string;
}): Promise<string[]> {
  const results = await Promise.all([
    writeKnowledgeAudit(input),
    enqueueKnowledgeProcessing(input),
  ]);
  return results.filter((warning): warning is string => warning !== null);
}

export async function createKnowledgeDocument(input: {
  organizationId: string;
  actorId: string;
  document: NewKnowledgeDocument;
}): Promise<CreatedKnowledgeDocumentResult> {
  if (input.document.file && input.document.file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    throw new Error(`File size must be under ${MAX_FILE_SIZE_MB}MB`);
  }

  let fileKey: string | null = null;
  let documentPersisted = false;
  const revision = crypto.randomUUID();
  const updatedAt = new Date().toISOString();
  try {
    let fileUrl: string | null = null;
    let fileName: string | null = null;
    if (input.document.file) {
      const uploadedFile = await uploadKnowledgeFile(
        input.organizationId,
        input.document.file,
      );
      fileUrl = uploadedFile.url;
      fileName = input.document.file.name;
      fileKey = uploadedFile.key;
    }

    const { data, error } = await insforge.database
      .from('knowledge_documents')
      .insert([{
        organization_id: input.organizationId,
        title: input.document.title,
        source_type: input.document.sourceType,
        body: input.document.body,
        status: 'pending',
        file_url: fileUrl,
        file_name: fileName,
        file_key: fileKey,
        content_revision: revision,
        updated_at: updatedAt,
      }])
      .select();
    if (error) throw new Error(error.message);

    const inserted = Array.isArray(data) ? data[0] : data;
    const documentId = inserted
      && typeof inserted === 'object'
      && 'id' in inserted
      && typeof inserted.id === 'string'
      ? inserted.id
      : null;
    if (!documentId) {
      throw new Error('Document insert did not return the created row.');
    }
    documentPersisted = true;

    const warnings = await runPostWriteTasks({
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: 'knowledge_document_created',
      documentId,
      metadata: { title: input.document.title },
      revision,
    });
    return { documentId, warnings };
  } catch (error) {
    const message = errorMessage(error, 'Failed to add document');
    if (fileKey && !documentPersisted) {
      throw new Error(await rollbackKnowledgeUpload(fileKey, message));
    }
    throw error instanceof Error ? error : new Error(message);
  }
}

export async function updateKnowledgeDocument(input: {
  document: KnowledgeDocument;
  actorId: string;
  title: string;
  sourceType: string;
  body: string;
}): Promise<KnowledgeMutationResult> {
  const revision = crypto.randomUUID();
  const updatedAt = new Date().toISOString();
  const { error } = await insforge.database
    .from('knowledge_documents')
    .update({
      title: input.title,
      source_type: input.sourceType,
      body: input.body,
      status: 'pending',
      content_revision: revision,
      updated_at: updatedAt,
    })
    .eq('id', input.document.id);
  if (error) throw new Error(error.message);

  return {
    warnings: await runPostWriteTasks({
      organizationId: input.document.organization_id,
      actorId: input.actorId,
      action: 'knowledge_document_updated',
      documentId: input.document.id,
      metadata: { title: input.title },
      revision,
    }),
  };
}

export async function reprocessKnowledgeDocument(input: {
  document: KnowledgeDocument;
  actorId: string;
}): Promise<KnowledgeMutationResult> {
  const revision = crypto.randomUUID();
  const updatedAt = new Date().toISOString();
  const { error } = await insforge.database
    .from('knowledge_documents')
    .update({
      status: 'pending',
      error_message: null,
      content_revision: revision,
      updated_at: updatedAt,
    })
    .eq('id', input.document.id);
  if (error) throw new Error(error.message);

  return {
    warnings: await runPostWriteTasks({
      organizationId: input.document.organization_id,
      actorId: input.actorId,
      action: 'knowledge_document_updated',
      documentId: input.document.id,
      metadata: { status: 'pending' },
      revision,
    }),
  };
}

export async function deleteKnowledgeDocument(input: {
  document: KnowledgeDocument;
  actorId: string;
}): Promise<KnowledgeMutationResult> {
  const { error } = await insforge.database
    .from('knowledge_documents')
    .delete()
    .eq('id', input.document.id);
  if (error) throw new Error(error.message);

  const tasks: Array<Promise<string | null>> = [
    writeKnowledgeAudit({
      organizationId: input.document.organization_id,
      actorId: input.actorId,
      action: 'knowledge_document_deleted',
      documentId: input.document.id,
      metadata: { title: input.document.title },
    }),
  ];
  const fileKey = input.document.file_key;
  if (fileKey) {
    tasks.push((async () => {
      try {
        await removeKnowledgeFile(fileKey);
        return null;
      } catch (error) {
        return `stored file cleanup failed: ${errorMessage(error, 'unknown error')}`;
      }
    })());
  }

  const results = await Promise.all(tasks);
  return {
    warnings: results.filter((warning): warning is string => warning !== null),
  };
}
