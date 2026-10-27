import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [nxViteTsPaths()],
  resolve: {
    alias: {
      '@threadplane/langgraph': fileURLToPath(
        new URL(
          '../../../../libs/langgraph/src/runtime/create-session.ts',
          import.meta.url
        )
      ),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
    maxWorkers: 2,
  },
});
