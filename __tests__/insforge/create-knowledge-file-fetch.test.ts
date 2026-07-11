import { describe, expect, it, vi } from 'vitest';
import { createKnowledgeFileFetch } from '../../insforge/functions/_shared/create-knowledge-file-fetch';

describe('createKnowledgeFileFetch', () => {
  it('resolves and follows a presigned private-object download strategy', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        method: 'presigned',
        url: 'https://storage.example/signed-file',
        headers: { 'x-signed-header': 'signed-value' },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response('file contents'));
    const fetchFile = createKnowledgeFileFetch(
      'https://example.insforge.app/',
      'service-role-key',
      fetchMock,
    );

    await fetchFile('https://attacker.example/untrusted.txt', 'org-1/documents/file name.txt');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://example.insforge.app/api/storage/buckets/knowledge-files/objects/org-1%2Fdocuments%2Ffile%20name.txt/download-strategy',
      {
        method: 'POST',
        headers: {
          apikey: 'service-role-key',
          Authorization: 'Bearer service-role-key',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiresIn: 3600 }),
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://storage.example/signed-file',
      {
        method: 'GET',
        headers: { 'x-signed-header': 'signed-value' },
      },
    );
  });

  it('authenticates direct strategy downloads on the InsForge origin', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        method: 'direct',
        url: '/api/storage/private-file',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response('file contents'));
    const fetchFile = createKnowledgeFileFetch(
      'https://example.insforge.app',
      'service-role-key',
      fetchMock,
    );

    await fetchFile('https://attacker.example/untrusted.txt', 'org-1/documents/file.txt');

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://example.insforge.app/api/storage/private-file',
      {
        method: 'GET',
        headers: {
          apikey: 'service-role-key',
          Authorization: 'Bearer service-role-key',
        },
      },
    );
  });

  it('does not forward service credentials to legacy external URLs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('legacy contents'));
    const fetchFile = createKnowledgeFileFetch(
      'https://example.insforge.app',
      'service-role-key',
      fetchMock,
    );

    await fetchFile('https://legacy.example/document.txt');

    expect(fetchMock).toHaveBeenCalledWith('https://legacy.example/document.txt');
  });
});
