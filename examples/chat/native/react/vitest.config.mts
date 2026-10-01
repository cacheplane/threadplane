import { defineConfig } from 'vitest/config';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [nxViteTsPaths()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.spec.tsx'],
    passWithNoTests: false,
  },
});
