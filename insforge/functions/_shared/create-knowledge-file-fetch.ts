import type { FileResponseFetcher } from '../../../packages/support-core/src/utils/file-content-fetcher.ts';

const KNOWLEDGE_BUCKET = 'knowledge-files';

interface DownloadStrategy {
  method: 'direct' | 'presigned';
  url: string;
  headers: Record<string, string>;
}

async function parseDownloadStrategy(response: Response): Promise<DownloadStrategy> {
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object') {
    throw new Error('Knowledge file download strategy returned an invalid response');
  }

  const record = payload as Record<string, unknown>;
  if (
    (record.method !== 'direct' && record.method !== 'presigned')
    || typeof record.url !== 'string'
  ) {
    throw new Error('Knowledge file download strategy is missing a supported method or URL');
  }

  const headers: Record<string, string> = {};
  if (record.headers && typeof record.headers === 'object') {
    for (const [name, value] of Object.entries(record.headers)) {
      if (typeof value === 'string') headers[name] = value;
    }
  }

  return { method: record.method, url: record.url, headers };
}

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

    const strategyUrl =
      `${projectBaseUrl}/api/storage/buckets/${KNOWLEDGE_BUCKET}/objects/` +
      `${encodeURIComponent(fileKey)}/download-strategy`;

    const serviceHeaders = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    };
    const strategyResponse = await fetchImpl(strategyUrl, {
      method: 'POST',
      headers: {
        ...serviceHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: 3600 }),
    });
    if (!strategyResponse.ok) return strategyResponse;

    const strategy = await parseDownloadStrategy(strategyResponse);
    const downloadUrl = new URL(strategy.url, `${projectBaseUrl}/`).toString();
    const downloadHeaders = { ...strategy.headers };

    // Direct downloads remain on this trusted InsForge origin and require
    // service authentication. Presigned downloads must not receive service
    // credentials; their signature and any strategy-provided headers are
    // sufficient.
    if (
      strategy.method === 'direct'
      && new URL(downloadUrl).origin === new URL(projectBaseUrl).origin
    ) {
      if (!downloadHeaders.apikey) downloadHeaders.apikey = serviceHeaders.apikey;
      if (!downloadHeaders.Authorization) {
        downloadHeaders.Authorization = serviceHeaders.Authorization;
      }
    }

    return fetchImpl(downloadUrl, {
      method: 'GET',
      headers: downloadHeaders,
    });
  };
}
