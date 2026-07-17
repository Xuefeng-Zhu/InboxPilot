const KNOWLEDGE_MUTATION_WARNING_KEY = 'knowledgeMutationWarning';

function logStorageFailure(operation: 'read' | 'write' | 'remove', error: unknown): void {
  console.warn(
    `Knowledge mutation warning could not be ${operation}:`,
    error instanceof Error ? error.message : String(error),
  );
}

/** Persist a cross-page mutation warning without blocking the completed action. */
export function storeKnowledgeMutationWarning(message: string): void {
  try {
    sessionStorage.setItem(KNOWLEDGE_MUTATION_WARNING_KEY, message);
  } catch (error) {
    logStorageFailure('write', error);
  }
}

/** Read and consume a cross-page warning. Browser storage is always best-effort. */
export function takeKnowledgeMutationWarning(): string | null {
  let message: string | null;
  try {
    message = sessionStorage.getItem(KNOWLEDGE_MUTATION_WARNING_KEY);
  } catch (error) {
    logStorageFailure('read', error);
    return null;
  }

  if (message) {
    try {
      sessionStorage.removeItem(KNOWLEDGE_MUTATION_WARNING_KEY);
    } catch (error) {
      logStorageFailure('remove', error);
    }
  }

  return message;
}
