import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'packages/support-core/__tests__/**/*.test.ts',
      'packages/support-core/__tests__/**/*.prop.test.ts',
      '__tests__/**/*.test.ts',
    ],
  },
  resolve: {
    alias: {
      '@support-core': path.resolve(__dirname, 'packages/support-core/src'),
      '@': path.resolve(__dirname),
    },
  },
});
