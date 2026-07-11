/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@/lib/insforge', () => ({
  insforge: {
    storage: {
      from: mocks.from,
    },
  },
}));

import {
  KNOWLEDGE_FILES_BUCKET,
  createKnowledgeFileKey,
  rollbackKnowledgeUpload,
  sanitizeKnowledgeFileName,
  uploadKnowledgeFile,
} from '../../app/knowledge/storage';

describe('knowledge storage lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.from.mockReturnValue({
      upload: mocks.upload,
      remove: mocks.remove,
    });
  });

  it('builds an organization-scoped key with a sanitized filename', () => {
    expect(sanitizeKnowledgeFileName('../../ Policy (final).pdf')).toBe('Policy-final.pdf');
    expect(createKnowledgeFileKey('org-123', '../../ Policy (final).pdf', 'file-456'))
      .toBe('org-123/documents/file-456-Policy-final.pdf');
  });

  it('persists the SDK-returned URL and key from the private knowledge bucket', async () => {
    mocks.upload.mockResolvedValue({
      data: {
        url: 'https://storage.example.invalid/object',
        key: 'org-123/documents/file-456-policy.pdf',
      },
      error: null,
    });

    const stored = await uploadKnowledgeFile(
      'org-123',
      new File(['policy'], 'policy.pdf', { type: 'application/pdf' }),
    );

    expect(mocks.from).toHaveBeenCalledWith(KNOWLEDGE_FILES_BUCKET);
    expect(mocks.upload).toHaveBeenCalledWith(
      expect.stringMatching(/^org-123\/documents\/.+-policy\.pdf$/),
      expect.any(File),
    );
    expect(stored).toEqual({
      url: 'https://storage.example.invalid/object',
      key: 'org-123/documents/file-456-policy.pdf',
    });
  });

  it('removes an uploaded object when document persistence fails', async () => {
    mocks.remove.mockResolvedValue({ data: { message: 'deleted' }, error: null });

    await expect(
      rollbackKnowledgeUpload('org-123/documents/file.pdf', 'Database insert failed.'),
    ).resolves.toBe('Database insert failed.');

    expect(mocks.remove).toHaveBeenCalledWith('org-123/documents/file.pdf');
  });

  it('preserves both the primary and cleanup errors when rollback fails', async () => {
    mocks.remove.mockResolvedValue({
      data: null,
      error: { message: 'storage unavailable' },
    });

    await expect(
      rollbackKnowledgeUpload('org-123/documents/file.pdf', 'Database insert failed.'),
    ).resolves.toContain('Database insert failed. Uploaded file cleanup also failed: storage unavailable');
  });
});
