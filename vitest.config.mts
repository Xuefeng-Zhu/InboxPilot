import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import path from 'node:path';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    globals: true,
    environment: 'node',
    include: [
      'packages/support-core/__tests__/**/*.test.ts',
      'packages/support-core/__tests__/**/*.prop.test.ts',
      '__tests__/**/*.test.ts',
      '__tests__/**/*.test.tsx',
      '__tests__/**/*.test.mjs',
      '__tests__/**/*.property.test.ts',
      '__tests__/**/*.property.test.tsx',
      '__tests__/**/*.prop.test.ts',
    ],
  },
  resolve: {
    alias: {
      '@support-core': path.resolve(rootDir, 'packages/support-core/src'),
      '@': rootDir,
    },
  },
});
