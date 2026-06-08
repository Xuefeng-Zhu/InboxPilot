import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'widget.ts'),
      name: 'InboxPilotWidget',
      fileName: () => 'widget.js',
      formats: ['iife'],
    },
    outDir: resolve(__dirname, '../public'),
    emptyOutDir: false,
    minify: 'terser',
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
