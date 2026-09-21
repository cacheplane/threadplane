import { defineConfig } from 'vite';

// Runs inside the installed React consumer: no workspace aliases or plugins.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  build: { outDir: 'dist', emptyOutDir: true },
});
