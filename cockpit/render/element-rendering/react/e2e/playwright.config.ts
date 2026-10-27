import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  workers: 1,
  fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:4618', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command:
      'node scripts/react-cockpit/serve.mjs render-element-rendering --no-parent',
    cwd: '../../../../..',
    url: 'http://127.0.0.1:4618',
    reuseExistingServer: false,
    timeout: 10000,
  },
});
