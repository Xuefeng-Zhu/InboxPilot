import type { FileResponseFetcher } from '../../../packages/support-core/src/utils/file-content-fetcher.ts';

const KNOWLEDGE_BUCKET = 'knowledge-files';

/**
 * Build the authenticated file downloader used by the knowledge worker.
 *
 * New records carry a trusted object key. For those, ignore the stored URL and
 * download only from this InsForge project with service credentials. Legacy
 * records have no key, so they retain the previous unauthenticated URL fetch;
 * critically, service credentials are never forwarded to that arbitrary URL.
 */
export function createKnowledgeFileFetch(
  baseUrl: string,
  serviceRoleKey: string,
  fetchImpl: typeof fetch = fetch,
): FileResponseFetcher {
  const projectBaseUrl = baseUrl.replace(/\/+$/, '');

  return async (legacyUrl: string, fileKey?: string | null): Promise<Response> => {
    if (!fileKey) {
      return fetchImpl(legacyUrl);
    }

    const objectUrl =
      `${projectBaseUrl}/api/storage/buckets/${KNOWLEDGE_BUCKET}/objects/` +
      encodeURIComponent(fileKey);

    return fetchImpl(objectUrl, {
      method: 'GET',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    });
  };
}
