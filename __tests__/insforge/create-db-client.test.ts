/**
 * Tests for the InsForge PostgREST DatabaseClient binding.
 *
 * Regression: `db.from('...').delete().eq(...)` on a PostgREST 204 No Content
 * response used to throw "Unexpected end of JSON input" because `res.json()`
 * was called unconditionally on a successful response. The execute() helper
 * now short-circuits on 204 and returns `{ data: null, error: null }`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDbClient } from '../../insforge/functions/_shared/create-db-client';

interface MockResponseInit {
  status: number;
  body?: string;
  contentType?: string;
}

function mockResponse({ status, body = '', contentType = 'application/json' }: MockResponseInit): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': contentType, 'content-length': String(body.length) }),
    text: () => Promise.resolve(body),
    json: () => (body.length === 0 ? Promise.reject(new SyntaxError('Unexpected end of JSON input')) : Promise.resolve(JSON.parse(body))),
  } as unknown as Response;
}

describe('createDbClient PostgREST binding', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns { data: null, error: null } when DELETE responds 204 No Content', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ status: 204 }));

    const db = createDbClient('https://example.insforge.app', 'service-role-key');
    const result = await db.from('knowledge_chunks').delete().eq('document_id', 'doc-123');

    expect(result.error).toBeNull();
    expect(result.data).toBeNull();
  });

  it('returns the deleted row count when DELETE returns 200 with a body', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ status: 200, body: '[]' }));

    const db = createDbClient('https://example.insforge.app', 'service-role-key');
    const result = await db.from('contacts').delete().eq('id', 'contact-1');

    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
  });

  it('returns a structured error when PostgREST responds with a non-2xx status', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        status: 403,
        body: JSON.stringify({ message: 'permission denied for table knowledge_chunks' }),
      }),
    );

    const db = createDbClient('https://example.insforge.app', 'service-role-key');
    const result = await db.from('knowledge_chunks').delete().eq('document_id', 'doc-123');

    expect(result.data).toBeNull();
    expect(result.error).not.toBeNull();
    expect(result.error?.message).toContain('permission denied');
  });

  it('JSON-serializes object operands for PostgREST contains filters', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ status: 200, body: '[]' }));

    const db = createDbClient('https://example.insforge.app', 'service-role-key');
    await db.from('support_jobs')
      .select('*')
      .contains('payload', {
        conversationId: 'conv-123',
        aiDecisionId: 'decision-456',
      });

    const requestUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(requestUrl.searchParams.get('payload')).toBe(
      'cs.{"conversationId":"conv-123","aiDecisionId":"decision-456"}',
    );
    expect(requestUrl.searchParams.get('payload')).not.toContain('[object Object]');
  });

  it('uses PostgREST array syntax for array contains filters', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ status: 200, body: '[]' }));

    const db = createDbClient('https://example.insforge.app', 'service-role-key');
    await db.from('contacts').select('*').contains('tags', ['vip', 'trial']);

    const requestUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(requestUrl.searchParams.get('tags')).toBe('cs.{vip,trial}');
  });
});
