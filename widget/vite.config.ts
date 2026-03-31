import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/sarah-widget.ts'),
      name: 'SarahWidget',
      fileName: 'sarah-widget',
      formats: ['iife'],
    },
    outDir: 'dist',
    minify: 'terser',
    rollupOptions: {
      output: {
        entryFileNames: 'sarah-widget.min.js',
      },
    },
  },
  test: {
    environment: 'jsdom',
  },
});
