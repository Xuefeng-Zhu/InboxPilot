import { insforge } from '@/lib/insforge';

export const KNOWLEDGE_FILES_BUCKET = 'knowledge-files';

export interface StoredKnowledgeFile {
  url: string;
  key: string;
}

function storageErrorMessage(error: unknown, fallback: string): string {
  if (
    error
    && typeof error === 'object'
    && 'message' in error
    && typeof error.message === 'string'
  ) {
    return error.message;
  }
  return fallback;
}

export function sanitizeKnowledgeFileName(fileName: string): string {
  const sanitized = fileName
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+\./g, '.')
    .replace(/^[._-]+|[._-]+$/g, '');
  return sanitized || 'file';
}

export function createKnowledgeFileKey(
  organizationId: string,
  fileName: string,
  uniqueId = crypto.randomUUID(),
): string {
  if (!organizationId.trim()) {
    throw new Error('An organization is required before uploading a knowledge file.');
  }
  return `${organizationId}/documents/${uniqueId}-${sanitizeKnowledgeFileName(fileName)}`;
}

export async function uploadKnowledgeFile(
  organizationId: string,
  file: File,
): Promise<StoredKnowledgeFile> {
  const requestedKey = createKnowledgeFileKey(organizationId, file.name);
  const { data, error } = await insforge.storage
    .from(KNOWLEDGE_FILES_BUCKET)
    .upload(requestedKey, file);

  if (error || !data) {
    throw new Error(storageErrorMessage(error, 'File upload failed'));
  }
  if (!data.url || !data.key) {
    throw new Error('File upload did not return both a URL and object key.');
  }

  return { url: data.url, key: data.key };
}

export async function removeKnowledgeFile(fileKey: string): Promise<void> {
  const { error } = await insforge.storage
    .from(KNOWLEDGE_FILES_BUCKET)
    .remove(fileKey);
  if (error) {
    throw new Error(storageErrorMessage(error, 'File deletion failed'));
  }
}

export async function rollbackKnowledgeUpload(
  fileKey: string,
  primaryError: string,
): Promise<string> {
  try {
    await removeKnowledgeFile(fileKey);
    return primaryError;
  } catch (cleanupError) {
    return `${primaryError} Uploaded file cleanup also failed: ${storageErrorMessage(cleanupError, 'unknown cleanup error')}`;
  }
}
