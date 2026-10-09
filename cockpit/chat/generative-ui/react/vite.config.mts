import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

export default defineConfig({
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
    environment: 'node',
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
    maxWorkers: 2,
  },
});
