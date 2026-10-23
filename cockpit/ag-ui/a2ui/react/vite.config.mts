import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [nxViteTsPaths()],
  resolve: {
    alias: {
      '@threadplane/ag-ui': fileURLToPath(
        new URL(
          '../../../../fixtures/react-parity/ag-ui-candidate/entry.ts',
          import.meta.url
        )
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
    maxWorkers: 1,
  },
});
