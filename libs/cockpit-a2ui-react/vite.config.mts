import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [nxViteTsPaths()],
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
    maxWorkers: 2,
  },
});
