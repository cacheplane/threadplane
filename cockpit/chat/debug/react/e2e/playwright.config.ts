import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  workers: 1,
  retries: 0,
  fullyParallel: false,
  timeout: 45000,
  // A real `langgraph dev` turn runs three nodes and two model calls.
  expect: { timeout: 15000 },
  outputDir: '../../../../../output/playwright/chat-debug-react',
  use: { baseURL: 'http://127.0.0.1:4645', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // aimock + real `langgraph dev`, shared with cockpit/chat/debug/angular.
  globalSetup: './global-setup-impl.ts',
  globalTeardown: require.resolve('../../../../../libs/e2e-harness/src/global-teardown'),
  webServer: {
    command: 'node scripts/react-cockpit/serve.mjs chat-debug --no-parent',
    cwd: '../../../../..',
    url: 'http://127.0.0.1:4645',
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    timeout: 10000,
  },
});
