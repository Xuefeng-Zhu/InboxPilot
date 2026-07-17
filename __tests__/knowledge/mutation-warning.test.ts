/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  storeKnowledgeMutationWarning,
  takeKnowledgeMutationWarning,
} from '../../app/knowledge/mutation-warning';

describe('knowledge mutation warning storage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('does not throw when warning storage is unavailable', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('storage disabled', 'SecurityError');
    });

    expect(() => storeKnowledgeMutationWarning('Document deleted with a warning')).not.toThrow();
  });

  it('returns null when warning storage cannot be read', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('storage disabled', 'SecurityError');
    });

    expect(takeKnowledgeMutationWarning()).toBeNull();
  });

  it('returns a warning even when consuming it cannot remove the stored value', () => {
    sessionStorage.setItem('knowledgeMutationWarning', 'Cleanup failed');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('storage disabled', 'SecurityError');
    });

    expect(takeKnowledgeMutationWarning()).toBe('Cleanup failed');
  });
});
