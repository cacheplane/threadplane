import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  outputDir: 'test-results',
  reporter: [['list']],
  workers: 1,
  fullyParallel: false,
  timeout: 60000,
  use: { baseURL: 'http://127.0.0.1:4630', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node scripts/react-cockpit/serve.mjs deep-agents-subagents',
    cwd: '../../../../..',
    url: 'http://127.0.0.1:4630',
    reuseExistingServer: false,
    timeout: 15000,
  },
});
