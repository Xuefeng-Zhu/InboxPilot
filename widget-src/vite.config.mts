import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const widgetRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  build: {
    lib: {
      entry: resolve(widgetRoot, 'widget.ts'),
      name: 'InboxPilotWidget',
      fileName: () => 'widget.js',
      formats: ['iife'],
    },
    outDir: resolve(widgetRoot, '../public'),
    emptyOutDir: false,
    minify: 'terser',
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
