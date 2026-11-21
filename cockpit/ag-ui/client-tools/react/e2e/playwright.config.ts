import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.', outputDir: './test-results', workers: 1, fullyParallel: false, timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:4640', trace: 'retain-on-failure' },
  projects: [{name:'chromium', use: {...devices['Desktop Chrome']}}],
  // aimock + the real AG-UI server, shared with cockpit/ag-ui/client-tools/angular.
  globalSetup: './global-setup-impl.ts',
  globalTeardown: require.resolve('../../../../../libs/e2e-harness/src/global-teardown'),
  webServer: {
    command: 'node scripts/react-cockpit/serve.mjs ag-ui-client-tools --no-parent',
    cwd: '../../../../..',
    url: 'http://127.0.0.1:4640', reuseExistingServer: false, timeout: 30000,
  },
});
