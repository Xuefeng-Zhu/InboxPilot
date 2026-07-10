import { defineConfig } from 'vitest/config';
import path from 'path';

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
      '@support-core': path.resolve(__dirname, 'packages/support-core/src'),
      '@': path.resolve(__dirname),
    },
  },
});
