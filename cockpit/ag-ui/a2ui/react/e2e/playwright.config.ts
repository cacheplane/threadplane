import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  workers: 1,
  retries: 0,
  fullyParallel: false,
  timeout: 60000,
  outputDir: '../../../../../output/playwright/ag-ui-a2ui-react',
  use: { baseURL: 'http://127.0.0.1:4647', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // aimock + the real AG-UI server, shared with cockpit/ag-ui/a2ui/angular.
  globalSetup: './global-setup-impl.ts',
  globalTeardown: require.resolve('../../../../../libs/e2e-harness/src/global-teardown'),
  webServer: {
    command: 'node scripts/react-cockpit/serve.mjs ag-ui-a2ui --no-parent',
    cwd: '../../../../..',
    url: 'http://127.0.0.1:4647/ag-ui/a2ui/react/',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
