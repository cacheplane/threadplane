import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  workers: 1,
  fullyParallel: false,
  // Each turn starts the real Python producer before its terminal state arrives.
  expect: { timeout: 15000 },
  use: { baseURL: 'http://127.0.0.1:4613', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // aimock + the real AG-UI server, shared with cockpit/ag-ui/subagents/angular.
  globalSetup: './global-setup-impl.ts',
  globalTeardown: require.resolve('../../../../../libs/e2e-harness/src/global-teardown'),
  webServer: {
    command: 'node scripts/react-cockpit/serve.mjs ag-ui-subagents',
    cwd: '../../../../..',
    url: 'http://127.0.0.1:4613',
    reuseExistingServer: false,
    timeout: 10000,
  },
});
