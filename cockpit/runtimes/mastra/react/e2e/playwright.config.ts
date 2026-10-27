import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  outputDir: './test-results',
  workers: 1,
  fullyParallel: false,
  timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:4641', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node scripts/react-cockpit/serve.mjs runtimes-mastra --no-parent',
    cwd: '../../../../..',
    url: 'http://127.0.0.1:4641',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
