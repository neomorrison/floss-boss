import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// base './' keeps every asset URL relative, so the same build works at
// neomorrison.github.io/floss-boss/ and on a local preview server.
// Harness pages (harness/*.html) are dev-only test beds and are not part of the build.
export default defineConfig(() => ({
  base: './',
  server: { port: 5181, strictPort: false },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      input: { main: resolve(__dirname, 'index.html') },
    },
  },
}));
