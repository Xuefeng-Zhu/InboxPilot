import { afterEach, describe, expect, it, vi } from 'vitest';

import processJobs from '../../insforge/functions/process-jobs/index.ts';

function makeRequest(method: string, headers?: HeadersInit): Request {
  return new Request('https://functions.example.test/process-jobs?health=1', {
    method,
    headers,
  });
}

describe('process-jobs request authentication', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects non-POST requests before reading worker configuration', async () => {
    const response = await processJobs(makeRequest('GET'));

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    await expect(response.json()).resolves.toEqual({ error: 'Method not allowed' });
  });

  it.each([
    ['missing', undefined],
    ['incorrect', 'wrong-secret'],
  ])('rejects %s credentials before constructing the service-role client', async (_label, secret) => {
    vi.stubEnv('PROCESS_JOBS_SECRET', 'expected-secret');
    const response = await processJobs(makeRequest(
      'POST',
      secret ? { 'X-Process-Jobs-Secret': secret } : undefined,
    ));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('fails closed when the dedicated worker secret is not configured', async () => {
    vi.stubEnv('PROCESS_JOBS_SECRET', '');

    const response = await processJobs(makeRequest('POST'));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Missing environment configuration',
    });
  });

  it.each([
    ['X-Process-Jobs-Secret', 'expected-secret'],
    ['Authorization', 'Bearer expected-secret'],
  ])('accepts a configured trusted-server credential', async (headerName, headerValue) => {
    vi.stubEnv('PROCESS_JOBS_SECRET', 'expected-secret');
    vi.stubEnv('INSFORGE_BASE_URL', '');
    vi.stubEnv('INSFORGE_SERVICE_ROLE_KEY', '');
    vi.stubEnv('SERVICE_ROLE_KEY', '');
    vi.stubEnv('API_KEY', '');

    const response = await processJobs(makeRequest('POST', {
      [headerName]: headerValue,
    }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Missing environment configuration',
    });
  });
});
