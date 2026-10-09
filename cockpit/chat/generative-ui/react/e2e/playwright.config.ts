import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  workers: 1,
  fullyParallel: false,
  timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:4627', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command:
      'node scripts/react-cockpit/serve.mjs chat-generative-ui --no-parent',
    cwd: '../../../../..',
    url: 'http://127.0.0.1:4627',
    reuseExistingServer: false,
    timeout: 15000,
  },
});
