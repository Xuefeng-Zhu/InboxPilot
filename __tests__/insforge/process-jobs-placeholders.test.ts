import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../../insforge/functions/process-jobs/index.ts', import.meta.url),
  'utf8',
);

describe('process-jobs placeholder handlers', () => {
  it('fails unsupported delivery-status retry jobs instead of completing them as no-ops', () => {
    expect(source).toContain("throw new Error('process_delivery_status retry handler is not implemented')");
  });

  it('fails retry_failed_jobs instead of completing it as a no-op', () => {
    expect(source).toContain("throw new Error('retry_failed_jobs handler is not implemented')");
  });
});
