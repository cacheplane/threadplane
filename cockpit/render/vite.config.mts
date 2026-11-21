import angular from '@analogjs/vite-plugin-angular';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [angular({ tsconfig: './tsconfig.spec.json' }), nxViteTsPaths()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['shared/**/*.spec.ts'],
    setupFiles: ['../../libs/angular/render/src/test-setup.ts'],
    pool: 'forks',
  },
});
