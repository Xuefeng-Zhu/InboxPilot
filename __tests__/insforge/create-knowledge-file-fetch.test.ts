import { describe, expect, it, vi } from 'vitest';
import { createKnowledgeFileFetch } from '../../insforge/functions/_shared/create-knowledge-file-fetch';

describe('createKnowledgeFileFetch', () => {
  it('uses the trusted file key and service credentials for private objects', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('file contents'));
    const fetchFile = createKnowledgeFileFetch(
      'https://example.insforge.app/',
      'service-role-key',
      fetchMock,
    );

    await fetchFile('https://attacker.example/untrusted.txt', 'org-1/documents/file name.txt');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.insforge.app/api/storage/buckets/knowledge-files/objects/org-1%2Fdocuments%2Ffile%20name.txt',
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
