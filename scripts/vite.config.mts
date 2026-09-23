import { defineConfig } from 'vite';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

// Vitest config for the root deployment/proxy generator scripts.
//
// Two runners share scripts/: the node:test suites listed in `exclude`
// below are invoked directly by .github/workflows/ci.yml (`node --test`),
// everything else matching `include` runs under vitest via `nx test scripts`.
// A new *.spec.ts / *.spec.mjs file here is picked up automatically; a new
// node:test suite must be added to `exclude` AND to the ci.yml `node --test`
// invocation, otherwise vitest fails loudly on it ("no test suite found") —
// loud-by-default beats silently unrun.
export default defineConfig({
  plugins: [nxViteTsPaths()],
  test: {
    environment: 'node',
    globals: true,
    include: ['*.spec.ts', '*.spec.mjs', 'examples/**/*.spec.ts'],
    exclude: [
      // node:test suites — run by ci.yml directly, not by vitest.
      'ci-scope.spec.mjs',
      'ci-workflow.spec.mjs',
      'verify-claude-review.spec.mjs',
      'cockpit-matrix.spec.mjs',
      'cockpit-ports.spec.mjs',
      'cockpit-runtime-bridge-coverage.spec.mjs',
      'verify-angular-support.spec.mjs',
    ],
    // Generator specs shell out to `npx tsx` and (re)generate committed
    // deployment manifests; keep them serial to avoid write races.
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
