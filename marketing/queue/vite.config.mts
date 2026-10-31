import { defineConfig } from 'vite';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

export default defineConfig({
  plugins: [nxViteTsPaths()],
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.spec.ts'],
  },
});
