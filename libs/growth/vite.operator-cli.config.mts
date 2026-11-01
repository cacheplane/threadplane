import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { defineConfig } from 'vite';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig({
  root: workspaceRoot,
  plugins: [nxViteTsPaths()],
  test: {
    environment: 'node',
    globals: true,
    include: [
      'scripts/apply-migrations.spec.ts',
      'scripts/growth-control.spec.ts',
      'scripts/growth-linkedin.spec.ts',
      'scripts/growth-linkedin-eml.spec.ts',
      'scripts/growth-observability.spec.ts',
      'scripts/import-resend-lifecycle.spec.ts',
      'scripts/cancel-resend-lifecycle.spec.ts',
    ],
  },
});
