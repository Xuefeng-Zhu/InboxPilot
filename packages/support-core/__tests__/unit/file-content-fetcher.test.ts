import { describe, expect, it, vi } from 'vitest';
import { createFileContentFetcher } from '../../src/utils/file-content-fetcher.js';

describe('createFileContentFetcher', () => {
  it('passes the optional object key through the portable download boundary', async () => {
    const fetchFile = vi.fn().mockResolvedValue(
      new Response('private knowledge content', { status: 200 }),
    );
    const fetcher = createFileContentFetcher(fetchFile);

    await expect(
      fetcher.fetchTextContent(
        'https://storage.example.invalid/legacy-url',
        'policy.txt',
        'org-1/documents/policy.txt',
      ),
    ).resolves.toBe('private knowledge content');

    expect(fetchFile).toHaveBeenCalledWith(
      'https://storage.example.invalid/legacy-url',
      'org-1/documents/policy.txt',
    );
  });
});
