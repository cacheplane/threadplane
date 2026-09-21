import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  resolve: {
    alias: [
      ['@threadplane/core', '../core/src/index.ts'],
      ['@threadplane/core/tools', '../core/src/tools/index.ts'],
    ].map(([name, path]) => ({
      find: new RegExp(`^${name}$`),
      replacement: fileURLToPath(new URL(path, import.meta.url)),
    })),
  },
  test: {
    environment: 'node',
    reporters: ['default'],
    include: ['src/runtime/**/*.spec.ts'],
    passWithNoTests: false,
  },
});
