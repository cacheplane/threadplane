import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';
export default defineConfig({
  testDir: '.',
  outputDir: resolve(__dirname, '../../../../../test-results/cockpit-runtimes-microsoft-agent-framework-react'),
  workers: 1,
  fullyParallel: false,
  timeout: 45000,
  retries: 0,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4642', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // aimock + the real AG-UI server, shared with cockpit/runtimes/microsoft-agent-framework/angular.
  globalSetup: './global-setup-impl.ts',
  globalTeardown: require.resolve('../../../../../libs/e2e-harness/src/global-teardown'),
  webServer: {
    command:
      'node scripts/react-cockpit/serve.mjs runtimes-microsoft-agent-framework --no-parent',
    cwd: '../../../../..',
    url: 'http://127.0.0.1:4642',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
