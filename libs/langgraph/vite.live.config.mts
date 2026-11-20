import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Live-backend suite: real sessions against real `langgraph dev` processes,
// with the model replaced by recorded fixtures. Needs `uv`, Python 3.12 and
// the `langgraph` CLI. Run with `npx nx run langgraph:runtime-live`.
export default defineConfig({
  root: import.meta.dirname,
  resolve: {
    alias: [
      ['@threadplane/core', '../core/src/index.ts'],
      ['@threadplane/core/tools', '../core/src/tools/index.ts'],
      ['@threadplane/core/testing', '../core/src/testing/index.ts'],
    ].map(([name, path]) => ({
      find: new RegExp(`^${name}$`),
      replacement: fileURLToPath(new URL(path, import.meta.url)),
    })),
  },
  test: {
    environment: 'node',
    reporters: ['default'],
    include: ['live/**/*.live.spec.ts'],
    passWithNoTests: false,
    // One backend at a time: each file owns a Python server and a model replay.
    fileParallelism: false,
    testTimeout: 90_000,
    hookTimeout: 240_000,
    teardownTimeout: 30_000,
  },
});
