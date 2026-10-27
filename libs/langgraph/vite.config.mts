import { defineConfig, configDefaults } from 'vitest/config';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

export default defineConfig({
  plugins: [nxViteTsPaths()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.spec.ts'],
    exclude: [...configDefaults.exclude, 'src/runtime/**'],
    setupFiles: ['src/test-setup.ts'],
  },
});
