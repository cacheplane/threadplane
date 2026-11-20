import { defineConfig } from 'vite';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [nxViteTsPaths()],
  resolve: {
    alias: {
      '@threadplane/langgraph': fileURLToPath(
        new URL(
          '../../../../libs/langgraph/src/public-api.ts',
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
import { fileURLToPath } from 'node:url';
