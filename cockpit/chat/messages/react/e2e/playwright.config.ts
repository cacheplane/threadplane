import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  workers: 1,
  fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:4620', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // aimock + real `langgraph dev`, shared with cockpit/chat/messages/angular.
  globalSetup: './global-setup-impl.ts',
  globalTeardown: require.resolve('../../../../../libs/e2e-harness/src/global-teardown'),
  webServer: {
    command: 'node scripts/react-cockpit/serve.mjs chat-messages',
    cwd: '../../../../..',
    url: 'http://127.0.0.1:4620',
    reuseExistingServer: false,
    timeout: 10000,
  },
});
