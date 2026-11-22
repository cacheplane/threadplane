import { defineConfig } from 'vitest/config';
import angular from '@analogjs/vite-plugin-angular';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

// One package, three suites. The chat and render entry points keep the setup
// they had as separate packages: Vitest globals, and a test environment that
// never sends install-collector traffic.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [angular(), nxViteTsPaths()],
  test: {
    reporters: ['default'],
    pool: 'forks',
    environment: 'jsdom',
    passWithNoTests: false,
    projects: [
      {
        extends: true,
        test: {
          name: 'angular',
          setupFiles: ['src/test-setup.ts'],
          include: [
            'src/**/*.spec.ts',
            'src/**/*.test.ts',
            'chat/src/*.spec.ts',
            'markdown/src/**/*.spec.ts',
            'markdown/src/**/*.test.ts',
            'testing/src/**/*.spec.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'chat',
          globals: true,
          setupFiles: ['chat/src/test-setup.ts'],
          include: [
            'chat/src/lib/**/*.spec.ts',
            'chat/src/packaging/**/*.spec.ts',
            'chat/math/src/**/*.spec.ts',
            'a2ui/src/**/*.spec.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'render',
          globals: true,
          setupFiles: ['render/src/test-setup.ts'],
          include: ['render/src/**/*.spec.ts', 'render/registry/src/**/*.spec.ts'],
        },
      },
    ],
  },
});
