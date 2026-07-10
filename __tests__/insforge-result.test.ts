import { describe, expect, it } from 'vitest';
import { assertInsforgeSuccess } from '@/lib/insforge-result';

describe('assertInsforgeSuccess', () => {
  it('returns when the SDK result has no error', () => {
    expect(() =>
      assertInsforgeSuccess({ error: null }, 'update conversation'),
    ).not.toThrow();
  });

  it('throws a contextual error for SDK result-tuple failures', () => {
    expect(() =>
      assertInsforgeSuccess(
        { error: { message: 'permission denied' } },
        'update conversation',
      ),
    ).toThrow('update conversation: permission denied');
  });
});
